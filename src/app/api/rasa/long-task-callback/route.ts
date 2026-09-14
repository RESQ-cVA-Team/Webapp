import { NextRequest, NextResponse } from "next/server";
import { fetchRasaTrackerEvents, mapRasaTrackerEvents } from "@/lib/rasaHistory";
import { getRasaBots, withRasaAuth } from "@/lib/rasaConfig";
import { buildRasaSenderId } from "@/lib/rasaSender";
import { getJob, touchJob } from "@/lib/jobStore";
import { verifyActionServiceBearer } from "@/lib/keycloakIntrospect";
import { publishCommittedHistoryItems, publishToSender, setCommittedCursorFloor } from "@/lib/sseBus";
import {
  createTraceErrorResponse,
  createTraceLogContext,
  normalizeTraceId,
  readTraceId,
  withTraceIdHeaders,
} from "@/lib/traceId";
import { logCompletedTurnIfEnabled, resolveLongTaskCallbackIdentity } from "@/lib/interactionLogCapture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CallbackControl = {
  type: "lock" | "release";
  jobId: string;
  scope?: string;
  source?: string;
  traceId?: string;
};

type CallbackPayload = {
  events?: unknown;
  controls?: unknown;
  traceId?: unknown;
};

function normalizeRasaUrl(input: string): string {
  return input.trim().replace(/\/$/, "");
}

// job.rasaUrl was itself chosen server-side (getRasaUrlForRequest in
// api/rasa/route.ts) and is never re-derived from caller input, but it's
// still re-checked against the known-bot allow-list as cheap defense in
// depth against a corrupted/tampered store entry.
function resolveRasaUrl(candidate: string): string | null {
  const normalizedCandidate = normalizeRasaUrl(candidate);
  const allowed = getRasaBots().map((bot) => normalizeRasaUrl(bot.url));
  return allowed.includes(normalizedCandidate) ? normalizedCandidate : null;
}

function resolveTraceId(req: NextRequest, body: Record<string, unknown>): string | null {
  return (
    readTraceId(req.headers) ??
    normalizeTraceId(req.nextUrl.searchParams.get("traceId")) ??
    normalizeTraceId(typeof body.traceId === "string" ? body.traceId : null)
  );
}

function isValidTrackerBotEvent(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (event.event !== "bot") return false;
  const textValid = typeof event.text === "string" && event.text.length > 0;
  const data = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : null;
  const customValid = !!(data?.custom && typeof data.custom === "object");
  const buttonsValid = !!(data && Array.isArray(data.buttons) && data.buttons.some(
    (b) => !!b && typeof b === "object" &&
      typeof (b as { title?: unknown }).title === "string" &&
      typeof (b as { payload?: unknown }).payload === "string"
  ));
  return textValid || customValid || buttonsValid;
}

function extractTrackerEvents(payload: CallbackPayload, traceId: string | null): Array<Record<string, unknown>> {
  const rawEvents = Array.isArray(payload.events) ? payload.events : [];
  return rawEvents
    .filter(isValidTrackerBotEvent)
    .map((entry) => {
      const event = { ...(entry as Record<string, unknown>) };
      const metadata: Record<string, unknown> =
        event.metadata && typeof event.metadata === "object"
          ? { ...(event.metadata as Record<string, unknown>) }
          : {};
      if (typeof metadata.source !== "string") metadata.source = "long-task-callback";
      if (traceId && typeof metadata.trace_id !== "string") metadata.trace_id = traceId;
      event.metadata = metadata;
      return event;
    });
}

function extractControls(payload: CallbackPayload, traceId: string | null): CallbackControl[] {
  if (!Array.isArray(payload.controls)) return [];
  const controls: CallbackControl[] = [];
  for (const entry of payload.controls) {
    if (!entry || typeof entry !== "object") continue;
    const c = entry as Record<string, unknown>;
    const type = c.type === "lock" || c.type === "release" ? c.type : null;
    const jobId = typeof c.jobId === "string" && c.jobId.trim().length > 0 ? c.jobId.trim() : null;
    if (!type || !jobId) continue;
    controls.push({
      type,
      jobId,
      scope: typeof c.scope === "string" ? c.scope : "long_action",
      source: typeof c.source === "string" ? c.source : "long-task-callback",
      traceId: typeof c.traceId === "string" ? c.traceId : traceId ?? undefined,
    });
  }
  return controls;
}

export async function POST(req: NextRequest) {
  const requestTraceId = readTraceId(req.headers);

  // Action's own service identity -- a Keycloak client-credentials token,
  // verified via introspection + azp claim. This is the only proof of
  // identity this endpoint accepts; the static LONG_TASK_CALLBACK_TOKEN
  // shared secret it replaced has been removed.
  const viaKeycloak = await verifyActionServiceBearer(req.headers.get("authorization"));
  if (!viaKeycloak) {
    console.warn("[long-task-callback] Unauthorized request", createTraceLogContext(requestTraceId));
    return createTraceErrorResponse("Unauthorized", 401, requestTraceId);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    console.warn("[long-task-callback] Invalid JSON body", createTraceLogContext(requestTraceId));
    return createTraceErrorResponse("Invalid JSON body", 400, requestTraceId);
  }

  const payload = body as CallbackPayload;
  const traceId = resolveTraceId(req, payload as unknown as Record<string, unknown>);

  // Identity for this callback is always resolved server-side from the
  // jobId minted (and stored) when the job started -- never from anything
  // the caller supplies in the request.
  const callbackJobId = req.nextUrl.searchParams.get("jobId")?.trim() || null;
  if (!callbackJobId) {
    console.warn("[long-task-callback] Missing jobId", createTraceLogContext(traceId));
    return createTraceErrorResponse("Missing jobId", 400, traceId);
  }

  const job = await getJob(callbackJobId);
  if (!job) {
    console.warn("[long-task-callback] Unknown or expired jobId", createTraceLogContext(traceId, { callbackJobId }));
    return createTraceErrorResponse("Unknown or expired job", 401, traceId);
  }

  const senderId = buildRasaSenderId(job.sub, job.threadId);

  const trackerEvents = extractTrackerEvents(payload, traceId);
  const controls = extractControls(payload, traceId);

  if (trackerEvents.length === 0 && controls.length === 0) {
    console.warn("[long-task-callback] Empty callback payload", createTraceLogContext(traceId, {
      callbackJobId,
      senderId,
    }));
    return createTraceErrorResponse("Empty payload", 400, traceId);
  }

  await touchJob(callbackJobId);

  const rasaUrl = resolveRasaUrl(job.rasaUrl);
  if (!rasaUrl) {
    console.warn("[long-task-callback] Job's stored rasaUrl is not an allowed bot", createTraceLogContext(traceId, {
      callbackJobId,
    }));
    return createTraceErrorResponse("Invalid rasaUrl", 400, traceId);
  }

  // Publish controls directly so the client can respond to lock/release signals.
  for (const control of controls) {
    await publishToSender(senderId, control);
  }

  console.info("[long-task-callback] Received callback payload", createTraceLogContext(traceId, {
    senderId,
    eventCount: trackerEvents.length,
    controlCount: controls.length,
  }));

  if (trackerEvents.length > 0) {
    const trackerResponse = await fetch(
      withRasaAuth(`${rasaUrl}/conversations/${senderId}/tracker/events`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trackerEvents),
      }
    );
    if (!trackerResponse.ok) {
      const errText = await trackerResponse.text();
      console.error("[long-task-callback] Failed to persist callback events to tracker", createTraceLogContext(traceId, {
        status: trackerResponse.status, senderId, response: errText,
      }));
      return createTraceErrorResponse("Failed to persist callback events", 502, traceId);
    }
  }

  // Re-read the canonical tracker state and publish only committed deltas.
  const committedTracker = await fetchRasaTrackerEvents(rasaUrl, senderId);
  if (committedTracker.error) {
    console.error("[long-task-callback] Failed to read committed tracker after persistence", createTraceLogContext(traceId, {
      senderId, status: committedTracker.status, error: committedTracker.error,
    }));
    return createTraceErrorResponse("Failed to read committed tracker", 502, traceId);
  }

  const committedItems = mapRasaTrackerEvents(committedTracker.events, true);
  const publishedMessages = await publishCommittedHistoryItems(senderId, committedItems, {
    source: "long-task-callback",
    traceId,
  });

  void resolveLongTaskCallbackIdentity(senderId).then((identity) =>
    logCompletedTurnIfEnabled({
      senderId,
      ...identity,
      items: committedItems,
      traceId,
      source: "long-task-callback",
    })
  );

  return NextResponse.json(
    { ok: true, senderId, events: trackerEvents.length, controls: controls.length, publishedMessages },
    { headers: withTraceIdHeaders(undefined, traceId) }
  );
}
