import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRasaUrlForRequest } from "@/lib/rasaConfig";
import { fetchRasaTrackerEvents } from "@/lib/rasaHistory";
import { putUserTokens } from "@/lib/userTokenVault";
import { buildRasaSenderId } from "@/lib/rasaSender";
import { addSubscriberForSender, setCommittedCursorFloor } from "@/lib/sseBus";
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

  await putUserTokens({
    sub: userSub,
    ...tokenPayload,
  });

  // Seed the committed cursor so new subscribers never replay already-committed events.
  const cookiesMap = new Map(req.cookies.getAll().map((c) => [c.name, c.value]));
  const rasaUrl = getRasaUrlForRequest(req.headers, cookiesMap);
  if (rasaUrl) {
    try {
      const tracker = await fetchRasaTrackerEvents(rasaUrl, senderId);
      if (!tracker.error) {
        await setCommittedCursorFloor(senderId, tracker.events.length - 1);
      } else {
        console.warn("[rasa][stream] Failed to seed committed cursor from tracker", {
          requestId,
          senderId,
          status: tracker.status,
          error: tracker.error,
        });
      }
    } catch (err) {
      console.warn("[rasa][stream] Tracker cursor seed threw", {
        requestId,
        senderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const encoder = new TextEncoder();
  const clientSignal: AbortSignal | undefined = (req as unknown as { signal?: AbortSignal }).signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        const data = JSON.stringify(payload ?? {});
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      let unsubscribe: (() => void) | null = null;
      let keepAlive: ReturnType<typeof setInterval> | null = null;
      let aborted = false;

      const cleanup = () => {
        aborted = true;
        if (keepAlive) clearInterval(keepAlive);
        if (unsubscribe) unsubscribe();
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

      // Registered before the (now async) subscribe call so an abort that
      // races ahead of it is still caught -- see the `aborted` check below.
      if (clientSignal) {
        clientSignal.addEventListener("abort", cleanup, { once: true });
      }

      unsubscribe = await addSubscriberForSender(senderId, send);
      if (aborted) {
        // Client already disconnected while the subscribe call was still
        // in flight (relevant now that it can await a Redis round-trip) --
        // clean up immediately rather than leaving a dangling subscriber.
        unsubscribe();
        return;
      }

      // Initial event so the client knows the stream is live
      send({ type: "connected" });

      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`: keep-alive\n\n`));
      }, 5000); //reduced from 25s to 10s to keep SSE alive
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
