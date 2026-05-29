import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { getFeedbackReporterAliases } from "@/lib/feedbackAccess";
import { isMessageFeedbackEnabled } from "@/lib/feedbackConfig";
import { listFeedbackStatusesForUserThread } from "@/lib/feedbackStore";
import { fetchRasaHistory } from "@/lib/rasaHistory";
import { getThreadForUser } from "@/lib/threadRegistryStore";

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
  const cookieStore = await cookies();
  const headerStore = await headers();
  const session = await auth();
  const userSub = session?.user?.id ? String(session.user.id) : null;

  if (!userSub) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const threadId = parseThreadId(req.nextUrl.searchParams.get("threadId"));

  if (threadId !== null) {
    const thread = await getThreadForUser(userSub, threadId);
    if (!thread) {
      return NextResponse.json({
        history: [],
        error: "Thread not found",
        status: 404,
      });
    }
  }

  const cookiesMap = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value]));

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
    console.error("Failed to fetch Rasa history", error);
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

  return NextResponse.json({ history, error: result.error, status: result.status });
}
