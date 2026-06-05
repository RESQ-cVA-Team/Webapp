import { NextRequest, NextResponse } from "next/server";
import { fetchRasaTrackerEvents, mapRasaTrackerEvents } from "@/lib/rasaHistory";
import { getRasaBots, withRasaAuth } from "@/lib/rasaConfig";
import { publishCommittedHistoryItems, publishToSender, setCommittedCursorFloor } from "@/lib/sseBus";
import {
  createTraceErrorResponse,
  createTraceLogContext,
  normalizeTraceId,
  readTraceId,
  withTraceIdHeaders,
} from "@/lib/traceId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LONG_TASK_CALLBACK_TOKEN = process.env.LONG_TASK_CALLBACK_TOKEN;

type CallbackPayload = {
  senderId: string;
  events?: unknown;
  controls?: unknown;
  rasaUrl?: unknown;
  traceId?: unknown;
};

type CallbackControl = {
  type: "lock" | "release";
  jobId: string;
  scope?: string;
  source?: string;
  traceId?: string;
};

function normalizeRasaUrl(input: string): string {
  return input.trim().replace(/\/$/, "");
}

function resolveRasaUrl(req: NextRequest, body: Record<string, unknown>): string | null {
  const fromQuery = req.nextUrl.searchParams.get("rasaUrl");
  const fromBody = typeof body.rasaUrl === "string" ? body.rasaUrl : null;
  const candidate = fromQuery ?? fromBody;
  if (!candidate) return null;

  const normalizedCandidate = normalizeRasaUrl(candidate);
  const allowed = getRasaBots().map((bot) => normalizeRasaUrl(bot.url));

  if (!allowed.includes(normalizedCandidate)) {
    return null;
  }

  return normalizedCandidate;
}

function resolveTraceId(req: NextRequest, body: Record<string, unknown>): string | null {
  return (
    readTraceId(req.headers) ??
    normalizeTraceId(req.nextUrl.searchParams.get("traceId")) ??
    normalizeTraceId(typeof body.traceId === "string" ? body.traceId : null)
  );
}

function isValidTrackerBotEvent(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Record<string, unknown>;
  if (event.event !== "bot") {
    return false;
  }

  const textValid = typeof event.text === "string" && event.text.length > 0;
  const data = event.data && typeof event.data === "object"
    ? (event.data as Record<string, unknown>)
    : null;
  const customValid = !!(data && data.custom && typeof data.custom === "object");
  const buttonsValid = !!(
    data &&
    Array.isArray(data.buttons) &&
    data.buttons.some(
      (button) =>
        !!button &&
        typeof button === "object" &&
        typeof (button as { title?: unknown }).title === "string" &&
        typeof (button as { payload?: unknown }).payload === "string"
    )
  );

  return textValid || customValid || buttonsValid;
}

function extractTrackerEvents(payload: CallbackPayload, traceId: string | null): Array<Record<string, unknown>> {
  const rawEvents = Array.isArray(payload.events) ? payload.events : [];

  const events: Array<Record<string, unknown>> = [];

  for (const entry of rawEvents) {
    if (!isValidTrackerBotEvent(entry)) {
      continue;
    }

    const event = { ...entry } as Record<string, unknown>;
    const metadata = event.metadata && typeof event.metadata === "object"
      ? ({ ...(event.metadata as Record<string, unknown>) })
      : {};

    if (typeof metadata.source !== "string") {
      metadata.source = "long-task-callback";
    }
    if (traceId && typeof metadata.trace_id !== "string") {
      metadata.trace_id = traceId;
    }

    event.metadata = metadata;
    events.push(event);
  }

  return events;
}

function extractControls(payload: CallbackPayload, traceId: string | null): CallbackControl[] {
  if (!Array.isArray(payload.controls)) {
    return [];
  }

  const controls: CallbackControl[] = [];

  for (const entry of payload.controls) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    const type = candidate.type === "lock" || candidate.type === "release" ? candidate.type : null;
    const jobId = typeof candidate.jobId === "string" && candidate.jobId.trim().length > 0
      ? candidate.jobId.trim()
      : null;

    if (!type || !jobId) {
      continue;
    }

    controls.push({
      type,
      jobId,
      scope: typeof candidate.scope === "string" ? candidate.scope : "long_action",
      source: typeof candidate.source === "string" ? candidate.source : "long-task-callback",
      traceId: typeof candidate.traceId === "string" ? candidate.traceId : traceId ?? undefined,
    });
  }

  return controls;
}

export async function POST(req: NextRequest) {
  const requestTraceId = readTraceId(req.headers);

  if (!LONG_TASK_CALLBACK_TOKEN) {
    console.error(
      "[long-task-callback] Missing LONG_TASK_CALLBACK_TOKEN environment variable",
      createTraceLogContext(requestTraceId)
    );
    return createTraceErrorResponse("Server misconfiguration", 500, requestTraceId);
  }

  const token = req.headers.get("x-long-task-callback-token");
  if (token !== LONG_TASK_CALLBACK_TOKEN) {
    console.warn("[long-task-callback] Unauthorized request: invalid token", createTraceLogContext(requestTraceId));
    return createTraceErrorResponse("Unauthorized", 401, requestTraceId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    console.warn("[long-task-callback] Invalid JSON body", createTraceLogContext(requestTraceId));
    return createTraceErrorResponse("Invalid JSON body", 400, requestTraceId);
  }

  if (!body || typeof body !== "object" || !("senderId" in body)) {
    console.warn("[long-task-callback] Missing senderId", createTraceLogContext(requestTraceId));
    return createTraceErrorResponse("Missing senderId", 400, requestTraceId);
  }

  const payload = body as CallbackPayload;
  const traceId = resolveTraceId(req, payload as unknown as Record<string, unknown>);
  const expectedSenderId = req.nextUrl.searchParams.get("senderId")?.trim() || null;
  const receivedSenderId = payload.senderId?.trim();
  const senderId = receivedSenderId;
  const trackerEvents = extractTrackerEvents(payload, traceId);
  const controls = extractControls(payload, traceId);

  if (!senderId || (trackerEvents.length === 0 && controls.length === 0)) {
    console.warn("[long-task-callback] Invalid senderId or empty callback payload", createTraceLogContext(traceId, {
      senderId: receivedSenderId,
      expectedSenderId,
      trackerEventCount: trackerEvents.length,
      controlsCount: controls.length,
    }));
    return createTraceErrorResponse("Invalid senderId or callback payload", 400, traceId);
  }

  if (expectedSenderId && expectedSenderId !== receivedSenderId) {
    console.warn("[long-task-callback] Sender mismatch between callback URL and payload", createTraceLogContext(traceId, {
      expectedSenderId,
      receivedSenderId,
    }));
    return createTraceErrorResponse("Sender mismatch", 400, traceId);
  }

  const rasaUrl = resolveRasaUrl(req, payload as unknown as Record<string, unknown>);
  if (!rasaUrl) {
    console.warn("[long-task-callback] Missing or invalid rasaUrl for callback persistence", createTraceLogContext(traceId));
    return createTraceErrorResponse("Missing or invalid rasaUrl", 400, traceId);
  }

  let publishedMessages = 0;
  if (trackerEvents.length > 0) {
    const baselineTracker = await fetchRasaTrackerEvents(rasaUrl, senderId);
    if (baselineTracker.error) {
      console.error("[long-task-callback] Failed to read baseline tracker before persistence", createTraceLogContext(traceId, {
        senderId,
        status: baselineTracker.status,
        error: baselineTracker.error,
      }));
      return createTraceErrorResponse("Failed to read Rasa tracker", 502, traceId);
    }

    const baselineEventIndex = baselineTracker.events.length - 1;
    setCommittedCursorFloor(senderId, baselineEventIndex);

    const customCount = trackerEvents.filter(
      (event) =>
        !!event.data &&
        typeof event.data === "object" &&
        !!(event.data as Record<string, unknown>).custom &&
        typeof (event.data as Record<string, unknown>).custom === "object"
    ).length;
    console.info("[long-task-callback] Received callback payload", createTraceLogContext(traceId, {
      senderId,
      messageCount: trackerEvents.length,
      trackerEventCount: trackerEvents.length,
      controlsCount: controls.length,
      customCount,
    }));
    const trackerResponse = await fetch(
      withRasaAuth(`${rasaUrl}/conversations/${senderId}/tracker/events`),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(trackerEvents),
      }
    );

    if (!trackerResponse.ok) {
      const errText = await trackerResponse.text();
      console.error("[long-task-callback] Failed to persist callback events to tracker", createTraceLogContext(traceId, {
        status: trackerResponse.status,
        senderId,
        response: errText,
      }));
      return createTraceErrorResponse("Failed to persist callback events", 502, traceId);
    }

    const committedTracker = await fetchRasaTrackerEvents(rasaUrl, senderId);
    if (committedTracker.error) {
      console.error("[long-task-callback] Failed to read committed tracker after persistence", createTraceLogContext(traceId, {
        senderId,
        status: committedTracker.status,
        error: committedTracker.error,
      }));
      return createTraceErrorResponse("Failed to read committed Rasa tracker", 502, traceId);
    }

    const committedItems = mapRasaTrackerEvents(committedTracker.events, true);
    publishedMessages = publishCommittedHistoryItems(senderId, committedItems, {
      minEventIndexExclusive: baselineEventIndex,
      source: "long-task-callback",
      traceId,
    });
  }

  for (const control of controls) {
    publishToSender(senderId, control);
  }

  return NextResponse.json(
    { ok: true, senderId, messages: publishedMessages, controls: controls.length },
    { headers: withTraceIdHeaders(undefined, traceId) }
  );
}
