import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { addSubscriberForSender } from "@/lib/sseBus";
import { putUserAccessToken } from "@/lib/userTokenVault";
import { buildRasaSenderId } from "@/lib/rasaSender";
import { readTraceId } from "@/lib/traceId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const requestId = readTraceId(req.headers) ?? crypto.randomUUID();
  const session = await auth();

  if (!session?.accessToken || !session.user?.id) {
    console.warn("[rasa][stream] Unauthorized request", {
      requestId,
      threadId: req.nextUrl.searchParams.get("threadId"),
      performsUpstreamCall: false,
    });
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const userSub = String(session.user.id);
  const threadParam = req.nextUrl.searchParams.get("threadId");
  const parsedThreadId = threadParam ? Number(threadParam) : NaN;
  const threadId = Number.isFinite(parsedThreadId) ? parsedThreadId : null;
  const senderId = buildRasaSenderId(userSub, threadId);

  console.info("[rasa][stream] Opening SSE subscription", {
    requestId,
    threadId,
    senderId,
    performsUpstreamCall: false,
  });

  const tokenPayload = {
    accessToken: String(session.accessToken),
    accessTokenExpiresAt:
      typeof session.accessTokenExpires === "number" ? session.accessTokenExpires : undefined,
  };

  putUserAccessToken({
    sub: senderId,
    ...tokenPayload,
  });

  const encoder = new TextEncoder();
  const clientSignal: AbortSignal | undefined = (req as unknown as { signal?: AbortSignal }).signal;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        const data = JSON.stringify(payload ?? {});
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const unsubscribe = addSubscriberForSender(senderId, send);

      // Initial event so the client knows the stream is live
      send({ type: "connected" });

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`: keep-alive\n\n`));
      }, 5000); //reduced from 25s to 10s to keep SSE alive

      const cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
        console.info("[rasa][stream] Closing SSE subscription", {
          requestId,
          threadId,
          senderId,
          performsUpstreamCall: false,
        });
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      if (clientSignal) {
        clientSignal.addEventListener("abort", cleanup, { once: true });
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
