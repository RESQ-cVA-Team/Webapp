import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { getFeedbackReporterAliases } from "@/lib/feedbackAccess";
import { isMessageFeedbackEnabled } from "@/lib/feedbackConfig";
import { listFeedbackStatusesForUserThread } from "@/lib/feedbackStore";
import { getRasaUrlForRequest } from "@/lib/rasaConfig";
import { fetchRasaHistory } from "@/lib/rasaHistory";
import { buildRasaSenderId } from "@/lib/rasaSender";
import { getThreadFromRasa } from "@/lib/rasaThreadIndex";
import { readTraceId } from "@/lib/traceId";

const CHAT_DEBUG_MODE = process.env.NODE_ENV === "development";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseThreadId(raw: string | null): number | null {
  if (!raw) return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function GET(req: NextRequest) {
  const requestId = readTraceId(req.headers) ?? crypto.randomUUID();
  const cookieStore = await cookies();
  const headerStore = await headers();
  const session = await auth();
  const userSub = session?.user?.id ? String(session.user.id) : null;

  if (!userSub) {
    console.warn("[rasa][history] Unauthorized request", {
      requestId,
      threadId: parseThreadId(req.nextUrl.searchParams.get("threadId")),
      performsUpstreamCall: false,
    });
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const threadId = parseThreadId(req.nextUrl.searchParams.get("threadId"));
  const senderId = buildRasaSenderId(userSub, threadId);

  const cookiesMap = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value]));

  if (threadId !== null) {
    const thread = await getThreadFromRasa({
      headers: headerStore,
      cookies: cookiesMap,
      userId: userSub,
      threadId,
    });
    if (!thread) {
      console.warn("[rasa][history] Thread not found for request", {
        requestId,
        threadId,
        senderId,
        performsUpstreamCall: false,
      });
      return NextResponse.json({
        history: [],
        error: "Thread not found",
        status: 404,
      });
    }
  }

  const apiUrl = getRasaUrlForRequest(headerStore, cookiesMap);
  const upstreamUrl = apiUrl ? `${apiUrl}/conversations/${senderId}/tracker` : null;

  console.info("[rasa][history] Handling request", {
    requestId,
    threadId,
    senderId,
    performsUpstreamCall: Boolean(upstreamUrl),
    upstreamMethod: upstreamUrl ? "GET" : null,
    upstreamUrl,
  });

  let result: Awaited<ReturnType<typeof fetchRasaHistory>>;
  try {
    result = await fetchRasaHistory({
      headers: headerStore,
      cookies: cookiesMap,
      userSub,
      threadId,
      includeDebugMetadata: CHAT_DEBUG_MODE,
    });
  } catch (error) {
    console.error("[rasa][history] Failed to fetch Rasa history", {
      requestId,
      threadId,
      senderId,
      upstreamUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    result = {
      history: [],
      error: error instanceof Error ? error.message : "Failed to fetch Rasa history",
      status: 502,
    };
  }

  let feedbackByMessageKey = new Map();

  if (isMessageFeedbackEnabled() && threadId) {
    try {
      feedbackByMessageKey = await listFeedbackStatusesForUserThread(getFeedbackReporterAliases(userSub), threadId);
    } catch (error) {
      console.error("Failed to load feedback statuses for history", error);
    }
  }

  const history = result.history.map((item) => {
    if (!item.feedbackKey) {
      return item;
    }

    return {
      ...item,
      feedback: feedbackByMessageKey.get(item.feedbackKey) ?? null,
    };
  });

  console.info("[rasa][history] Completed request", {
    requestId,
    threadId,
    senderId,
    performsUpstreamCall: Boolean(upstreamUrl),
    upstreamMethod: upstreamUrl ? "GET" : null,
    upstreamUrl,
    upstreamStatus: result.status,
    historyItems: history.length,
    error: result.error ?? null,
  });

  return NextResponse.json({ history, error: result.error, status: result.status });
}
