import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRasaUrlForRequest, withRasaAuth } from "@/lib/rasaConfig";
import { fetchRasaTrackerEvents, mapRasaTrackerEvents } from "@/lib/rasaHistory";
import { putUserAccessToken } from "@/lib/userTokenVault";
import { buildRasaSenderId } from "@/lib/rasaSender";
import { publishCommittedHistoryItems, setCommittedCursorFloor } from "@/lib/sseBus";
import {
  createTraceErrorResponse,
  createTraceLogContext,
  readTraceId,
  withTraceIdHeaders,
} from "@/lib/traceId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

async function drainUpstreamStream(response: Response): Promise<number> {
  const reader = response.body?.getReader();
  if (!reader) {
    return 0;
  }

  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytesRead += value?.byteLength ?? 0;
  }

  return bytesRead;
}

export async function POST(req: NextRequest) {
  const traceId = readTraceId(req.headers);
  const requestId = traceId ?? crypto.randomUUID();

  try {
    const session = await auth();

    if (!session?.accessToken || !session.user?.id) {
      console.warn("[rasa][post] Unauthorized request", {
        requestId,
        performsUpstreamCall: false,
      });
      return new NextResponse("Unauthorized", {
        status: 401,
        headers: withTraceIdHeaders(undefined, traceId),
      });
    }

    const userSub = String(session.user.id);
    const body = await req.json();
    const message = typeof body?.message === "string" ? body.message : "";
    const uiDisplayText =
      typeof body?.uiDisplayText === "string" && body.uiDisplayText.trim().length > 0
        ? body.uiDisplayText
        : null;
    const rawThreadId = body?.threadId;
    const threadId = typeof rawThreadId === "number" && Number.isFinite(rawThreadId) ? rawThreadId : null;
    const senderId = buildRasaSenderId(userSub, threadId);

    const tokenPayload = {
      accessToken: String(session.accessToken),
      accessTokenExpiresAt:
        typeof session.accessTokenExpires === "number" ? session.accessTokenExpires : undefined,
    };

    putUserAccessToken({
      sub: senderId,
      ...tokenPayload,
    });

    const apiUrl = getRasaUrlForRequest(req.headers, new Map(req.cookies.getAll().map(c => [c.name, c.value])));
    if (!apiUrl) {
      return new NextResponse("Rasa not configured", {
        status: 500,
        headers: withTraceIdHeaders(undefined, traceId),
      });
    }

    const baseCallback = process.env.CALLBACK_BASE_URL;
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const callbackBase = baseCallback
      ? `${baseCallback.replace(/\/$/, "")}/api/rasa/long-task-callback`
      : host
        ? `${proto}://${host}/api/rasa/long-task-callback`
        : null;
    const callbackUrl = callbackBase
      ? `${callbackBase}?rasaUrl=${encodeURIComponent(apiUrl)}&senderId=${encodeURIComponent(senderId)}${traceId ? `&traceId=${encodeURIComponent(traceId)}` : ""}`
      : null;
    const upstreamUrl = `${apiUrl}/webhooks/rest/webhook?stream=true`;

    const baselineTracker = await fetchRasaTrackerEvents(apiUrl, senderId);
    if (baselineTracker.error) {
      console.error("[rasa][post] Failed to read baseline tracker before upstream call", createTraceLogContext(traceId, {
        requestId,
        senderId,
        threadId,
        rasaUrl: apiUrl,
        status: baselineTracker.status,
        error: baselineTracker.error,
      }));
      return createTraceErrorResponse("Failed to read Rasa tracker", 502, traceId);
    }

    const baselineEventIndex = baselineTracker.events.length - 1;
    setCommittedCursorFloor(senderId, baselineEventIndex);

    console.info("[rasa][post] Forwarding chat request", createTraceLogContext(traceId, {
      requestId,
      senderId,
      threadId,
      performsUpstreamCall: true,
      upstreamMethod: "POST",
      upstreamUrl,
      messageLength: message.length,
      hasCallbackUrl: Boolean(callbackUrl),
      rasaUrl: apiUrl,
    }));

    let rasaStreamRes: Response;
    try {
      const requestMetadata: Record<string, unknown> = {
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        ...(traceId ? { trace_id: traceId } : {}),
        ...(uiDisplayText ? { ui_display_text: uiDisplayText } : {}),
      };

      rasaStreamRes = await fetch(withRasaAuth(`${apiUrl}/webhooks/rest/webhook?stream=true`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: senderId,
          message,
          ...(Object.keys(requestMetadata).length > 0
            ? {
                metadata: requestMetadata,
              }
            : {}),
        }),
      });
    } catch (error) {
      console.error("[rasa][post] Upstream webhook request threw before response", createTraceLogContext(traceId, {
        requestId,
        senderId,
        upstreamUrl,
        rasaUrl: apiUrl,
        error: error instanceof Error ? error.message : String(error),
      }));
      return createTraceErrorResponse("Rasa upstream unavailable", 502, traceId);
    }

    console.info("[rasa][post] Received upstream stream response", createTraceLogContext(traceId, {
      requestId,
      senderId,
      upstreamUrl,
      status: rasaStreamRes.status,
    }));

    if (!rasaStreamRes.ok) {
      const errorText = await rasaStreamRes.text();
      console.error("[rasa][post] Upstream webhook request failed", createTraceLogContext(traceId, {
        requestId,
        senderId,
        upstreamUrl,
        status: rasaStreamRes.status,
        response: errorText,
      }));

      return new NextResponse(errorText || "Rasa request failed", {
        status: rasaStreamRes.status,
        headers: withTraceIdHeaders(undefined, traceId),
      });
    }

    const upstreamBytesRead = await drainUpstreamStream(rasaStreamRes);

    const committedTracker = await fetchRasaTrackerEvents(apiUrl, senderId);
    if (committedTracker.error) {
      console.error("[rasa][post] Failed to read committed tracker after upstream call", createTraceLogContext(traceId, {
        requestId,
        senderId,
        threadId,
        rasaUrl: apiUrl,
        status: committedTracker.status,
        error: committedTracker.error,
      }));
      return createTraceErrorResponse("Failed to read committed Rasa tracker", 502, traceId);
    }

    const committedItems = mapRasaTrackerEvents(committedTracker.events, true);
    const publishedMessages = publishCommittedHistoryItems(senderId, committedItems, {
      minEventIndexExclusive: baselineEventIndex,
      source: "rasa-webhook",
      traceId,
    });

    console.info("[rasa][post] Published committed tracker messages to SSE", createTraceLogContext(traceId, {
      requestId,
      senderId,
      threadId,
      upstreamUrl,
      baselineEventIndex,
      trackerEvents: committedTracker.events.length,
      upstreamBytesRead,
      publishedMessages,
    }));

    return NextResponse.json(
      { ok: true, senderId, publishedMessages },
      { headers: withTraceIdHeaders(undefined, traceId) }
    );
  } catch (error) {
    console.error("[rasa][post] Unhandled route error", createTraceLogContext(traceId, {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return createTraceErrorResponse("Chat request failed", 500, traceId);
  }
}
