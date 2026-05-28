import { NextRequest, NextResponse } from "next/server";
import { publishToSender } from "@/lib/sseBus";
import { getRasaBots, withRasaAuth } from "@/lib/rasaConfig";
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

type CallbackMessage = {
  text?: unknown;
  custom?: unknown;
  buttons?: unknown;
};

type CallbackPayload = {
  senderId: string;
  messages: Array<Record<string, unknown>>;
  rasaUrl?: unknown;
  traceId?: unknown;
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

function toTrackerEvents(messages: CallbackMessage[], traceId: string | null): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;

    const text = typeof message.text === "string" ? message.text : null;
    const custom =
      message.custom && typeof message.custom === "object"
        ? (message.custom as Record<string, unknown>)
        : null;

    if (!text && !custom) continue;

    const event: Record<string, unknown> = {
      event: "bot",
      metadata: {
        source: "long-task-callback",
        ...(traceId ? { trace_id: traceId } : {}),
      },
    };

    if (text) {
      event.text = text;
    }

    if (custom) {
      event.data = { custom };
    }

    events.push(event);
  }

  return events;
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

  if (!body || typeof body !== "object" || !("senderId" in body) || !("messages" in body)) {
    console.warn("[long-task-callback] Missing senderId or messages", createTraceLogContext(requestTraceId));
    return createTraceErrorResponse("Missing senderId or messages", 400, requestTraceId);
  }

  const payload = body as CallbackPayload;
  const traceId = resolveTraceId(req, payload as unknown as Record<string, unknown>);
  const expectedSenderId = req.nextUrl.searchParams.get("senderId")?.trim() || null;
  const receivedSenderId = payload.senderId?.trim();
  const senderId = receivedSenderId;
  const { messages } = payload;

  if (!senderId || !Array.isArray(messages) || messages.length === 0) {
    console.warn("[long-task-callback] Invalid senderId or empty messages", createTraceLogContext(traceId, {
      senderId: receivedSenderId,
      expectedSenderId,
      messagesLength: Array.isArray(messages) ? messages.length : undefined,
    }));
    return createTraceErrorResponse("Invalid senderId or messages", 400, traceId);
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

  const trackerEvents = toTrackerEvents(messages as CallbackMessage[], traceId);
  const customCount = (messages as CallbackMessage[]).filter(
    (msg) => !!msg && typeof msg === "object" && !!msg.custom && typeof msg.custom === "object"
  ).length;
  console.info("[long-task-callback] Received callback payload", createTraceLogContext(traceId, {
    senderId,
    messageCount: messages.length,
    trackerEventCount: trackerEvents.length,
    customCount,
  }));
  if (trackerEvents.length > 0) {
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
  }

  for (const msg of messages) {
    publishToSender(senderId, msg);
  }

  return NextResponse.json(
    { ok: true, senderId, messages: messages.length },
    { headers: withTraceIdHeaders(undefined, traceId) }
  );
}
