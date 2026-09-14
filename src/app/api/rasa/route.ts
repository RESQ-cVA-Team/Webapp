import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRasaUrlForRequest, withRasaAuth, withUserBearerHeader } from "@/lib/rasaConfig";
import { fetchRasaTrackerEvents, mapRasaTrackerEvents } from "@/lib/rasaHistory";
import { putUserTokens } from "@/lib/userTokenVault";
import { buildRasaSenderId } from "@/lib/rasaSender";
import { createJob } from "@/lib/jobStore";
import { publishCommittedHistoryItems, setCommittedCursorFloor } from "@/lib/sseBus";
import {
  createTraceErrorResponse,
  createTraceLogContext,
  readTraceId,
  withTraceIdHeaders,
} from "@/lib/traceId";
import { logCompletedTurnIfEnabled } from "@/lib/interactionLogCapture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

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
    const inputMetadata =
      body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? { ...(body.metadata as Record<string, unknown>) }
        : {};
    const uiDisplayText =
      typeof body?.uiDisplayText === "string" && body.uiDisplayText.trim().length > 0
        ? body.uiDisplayText
        : typeof inputMetadata.ui_display_text === "string" && inputMetadata.ui_display_text.trim().length > 0
          ? inputMetadata.ui_display_text
        : null;
    const rawThreadId = body?.threadId;
    const threadId = typeof rawThreadId === "number" && Number.isFinite(rawThreadId) ? rawThreadId : null;
    const senderId = buildRasaSenderId(userSub, threadId);

    const tokenPayload = {
      accessToken: String(session.accessToken),
      accessTokenExpiresAt:
        typeof session.accessTokenExpires === "number" ? session.accessTokenExpires : undefined,
    };

    await putUserTokens({
      sub: userSub,
      ...tokenPayload,
    });

    const apiUrl = getRasaUrlForRequest(req.headers, new Map(req.cookies.getAll().map(c => [c.name, c.value])));
    if (!apiUrl) {
      return new NextResponse("Rasa not configured", {
        status: 500,
        headers: withTraceIdHeaders(undefined, traceId),
      });
    }

    // No request-header fallback (e.g. x-forwarded-host) -- that value is
    // caller-controllable and would let a request redirect where its own
    // callback (including whatever auth it carries) gets delivered. If
    // CALLBACK_BASE_URL isn't configured, this request simply gets no
    // callback support; Action already degrades to synchronous execution
    // when no callback_url is present.
    const baseCallback = process.env.CALLBACK_BASE_URL;
    const callbackBase = baseCallback
      ? `${baseCallback.replace(/\/$/, "")}/api/rasa/long-task-callback`
      : null;
    // The callback URL carries only an opaque jobId, never rasaUrl/senderId
    // directly -- the long-task-callback route resolves the real identity
    // server-side via jobStore, rather than trusting whatever a caller
    // echoes back in the request.
    let callbackUrl: string | null = null;
    if (callbackBase) {
      const jobId = await createJob({ sub: userSub, threadId, rasaUrl: apiUrl });
      callbackUrl = `${callbackBase}?jobId=${encodeURIComponent(jobId)}${traceId ? `&traceId=${encodeURIComponent(traceId)}` : ""}`;
    }
    const upstreamUrl = `${apiUrl}/webhooks/rest/webhook?stream=true`;

    // Snapshot tracker state before the upstream call so we can publish only
    // newly committed events afterwards.
    const baselineTracker = await fetchRasaTrackerEvents(apiUrl, senderId);
    if (baselineTracker.error) {
      console.error("[rasa][post] Failed to read baseline tracker", createTraceLogContext(traceId, {
        requestId, senderId, threadId, rasaUrl: apiUrl,
        status: baselineTracker.status, error: baselineTracker.error,
      }));
      return createTraceErrorResponse("Failed to read Rasa tracker", 502, traceId);
    }
    const baselineEventIndex = baselineTracker.events.length - 1;
    await setCommittedCursorFloor(senderId, baselineEventIndex);

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
        ...inputMetadata,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        ...(traceId ? { trace_id: traceId } : {}),
        ...(uiDisplayText ? { ui_display_text: uiDisplayText } : {}),
      };

      rasaStreamRes = await fetch(withRasaAuth(`${apiUrl}/webhooks/rest/webhook?stream=true`), {
        method: "POST",
        headers: withUserBearerHeader({ "Content-Type": "application/json" }, session.accessToken),
        body: JSON.stringify({
          sender: senderId,
          message,
          ...(Object.keys(requestMetadata).length > 0 ? { metadata: requestMetadata } : {}),
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

    // Drain the upstream stream body (Rasa requires it to be consumed even
    // when a callback URL is configured, otherwise the connection stalls).
    if (rasaStreamRes.body) {
      const reader = rasaStreamRes.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }

    // Snapshot committed tracker state and publish only new items.
    const committedTracker = await fetchRasaTrackerEvents(apiUrl, senderId);
    if (committedTracker.error) {
      console.error("[rasa][post] Failed to read committed tracker after upstream", createTraceLogContext(traceId, {
        requestId, senderId, threadId, rasaUrl: apiUrl,
        status: committedTracker.status, error: committedTracker.error,
      }));
      return createTraceErrorResponse("Failed to read committed Rasa tracker", 502, traceId);
    }

    const committedItems = mapRasaTrackerEvents(committedTracker.events, true);
    const publishedMessages = await publishCommittedHistoryItems(senderId, committedItems, {
      minEventIndexExclusive: baselineEventIndex,
      source: "rasa-webhook",
      traceId,
    });

    void logCompletedTurnIfEnabled({
      senderId,
      userSub,
      userEmail: session.user.email ?? null,
      userName: session.user.name ?? null,
      threadId,
      items: committedItems,
      traceId: traceId ?? null,
      source: "sync",
    });

    console.info("[rasa][post] Published committed tracker messages to SSE", createTraceLogContext(traceId, {
      requestId,
      senderId,
      threadId,
      upstreamUrl,
      baselineEventIndex,
      trackerEvents: committedTracker.events.length,
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
