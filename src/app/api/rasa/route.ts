import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { getRasaUrlForRequest, withRasaAuth } from "@/lib/rasaConfig";
import { putUserAccessToken } from "@/lib/userTokenVault";
import { buildRasaSenderId } from "@/lib/rasaSender";
import { publishToSender } from "@/lib/sseBus";
import { touchThreadForUser } from "@/lib/threadRegistryStore";
import {
  createTraceErrorResponse,
  createTraceLogContext,
  readTraceId,
  withTraceIdHeaders,
} from "@/lib/traceId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

function publishRasaStreamChunk(senderId: string, chunk: string): number {
  let published = 0;
  const lines = chunk.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const payload = JSON.parse(trimmed) as unknown;

      if (Array.isArray(payload)) {
        for (const item of payload) {
          publishToSender(senderId, item);
          published += 1;
        }
        continue;
      }

      publishToSender(senderId, payload);
      published += 1;
    } catch (error) {
      console.warn("[rasa] Failed to parse upstream message chunk", {
        senderId,
        line: trimmed,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return published;
}

export async function POST(req: NextRequest) {
  const traceId = readTraceId(req.headers);

  try {
    const token = await getToken({ req });

    if (!token?.accessToken || !token?.sub) {
      return new NextResponse("Unauthorized", {
        status: 401,
        headers: withTraceIdHeaders(undefined, traceId),
      });
    }

    const userSub = String(token.sub);
    const body = await req.json();
    const message = typeof body?.message === "string" ? body.message : "";
    const rawThreadId = body?.threadId;
    const threadId = typeof rawThreadId === "number" && Number.isFinite(rawThreadId) ? rawThreadId : null;
    const senderId = buildRasaSenderId(userSub, threadId);

    if (typeof threadId === "number") {
      try {
        await touchThreadForUser(userSub, threadId);
      } catch (error) {
        console.warn("[rasa] Failed to touch thread before forwarding chat request", createTraceLogContext(traceId, {
          senderId,
          threadId,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    const tokenPayload = {
      accessToken: String(token.accessToken),
      accessTokenExpiresAt:
        typeof token.accessTokenExpires === "number" ? token.accessTokenExpires : undefined,
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

    console.info("[rasa] Forwarding chat request", createTraceLogContext(traceId, {
      senderId,
      threadId,
      hasCallbackUrl: Boolean(callbackUrl),
      rasaUrl: apiUrl,
    }));

    let rasaStreamRes: Response;
    try {
      rasaStreamRes = await fetch(withRasaAuth(`${apiUrl}/webhooks/rest/webhook?stream=true`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: senderId,
          message,
          ...(callbackUrl
            ? {
                metadata: {
                  callback_url: callbackUrl,
                  ...(traceId ? { trace_id: traceId } : {}),
                },
              }
            : {}),
        }),
      });
    } catch (error) {
      console.error("[rasa] Upstream webhook request threw before response", createTraceLogContext(traceId, {
        senderId,
        rasaUrl: apiUrl,
        error: error instanceof Error ? error.message : String(error),
      }));
      return createTraceErrorResponse("Rasa upstream unavailable", 502, traceId);
    }

    console.info("[rasa] Received upstream stream response", createTraceLogContext(traceId, {
      senderId,
      status: rasaStreamRes.status,
    }));

    if (!rasaStreamRes.ok) {
      const errorText = await rasaStreamRes.text();
      console.error("[rasa] Upstream webhook request failed", createTraceLogContext(traceId, {
        senderId,
        status: rasaStreamRes.status,
        response: errorText,
      }));

      return new NextResponse(errorText || "Rasa request failed", {
        status: rasaStreamRes.status,
        headers: withTraceIdHeaders(undefined, traceId),
      });
    }

    let publishedMessages = 0;
    const reader = rasaStreamRes.body?.getReader();

    if (reader) {
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        publishedMessages += publishRasaStreamChunk(senderId, lines.join("\n"));
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        publishedMessages += publishRasaStreamChunk(senderId, buffer);
      }
    } else {
      const bodyText = await rasaStreamRes.text();
      if (bodyText.trim()) {
        publishedMessages += publishRasaStreamChunk(senderId, bodyText);
      }
    }

    console.info("[rasa] Published upstream messages to SSE", createTraceLogContext(traceId, {
      senderId,
      publishedMessages,
    }));

    return NextResponse.json(
      { ok: true, senderId, publishedMessages },
      { headers: withTraceIdHeaders(undefined, traceId) }
    );
  } catch (error) {
    console.error("[rasa] Unhandled route error", createTraceLogContext(traceId, {
      error: error instanceof Error ? error.message : String(error),
    }));
    return createTraceErrorResponse("Chat request failed", 500, traceId);
  }
}
