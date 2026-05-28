import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { headers as nextHeaders } from "next/headers";
import { getThreadForUser } from "@/lib/threadRegistryStore";
import { createFeedbackReporterKey, getFeedbackIdentityFromToken, getFeedbackReporterAliases } from "@/lib/feedbackAccess";
import {
  getFeedbackCommentMaxLength,
  getFeedbackDisclosureText,
  isMessageFeedbackEnabled,
  normalizeFeedbackIssues,
  normalizeFeedbackRating,
  shouldCaptureFeedbackConversationContext,
} from "@/lib/feedbackConfig";
import { createMessageFeedback } from "@/lib/feedbackStore";
import { fetchRasaHistory } from "@/lib/rasaHistory";
import { collectFeedbackServiceSnapshots } from "@/lib/serviceVersionCollector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEEDBACK_DEBUG_MODE = process.env.NODE_ENV === "development";

type FeedbackRequestBody = {
  threadId?: unknown;
  messageKey?: unknown;
  messageText?: unknown;
  rating?: unknown;
  issues?: unknown;
  detailText?: unknown;
};

export async function POST(req: NextRequest) {
  if (!isMessageFeedbackEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const token = await getToken({ req });
  if (!token) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const identity = getFeedbackIdentityFromToken(token);
  if (!identity.userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let reporterKey: string | null;
  try {
    reporterKey = createFeedbackReporterKey(identity.userId);
  } catch (error) {
    console.error("Feedback reporter key configuration error", error);
    return NextResponse.json({ message: "Server misconfiguration" }, { status: 500 });
  }

  if (!reporterKey) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: FeedbackRequestBody;
  try {
    body = (await req.json()) as FeedbackRequestBody;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const threadId = typeof body.threadId === "number" && Number.isFinite(body.threadId) ? body.threadId : null;
  const messageKey = typeof body.messageKey === "string" ? body.messageKey.trim() : "";
  const messageText = typeof body.messageText === "string" ? body.messageText.trim() : "";
  const rating = normalizeFeedbackRating(body.rating);
  const issues = normalizeFeedbackIssues(body.issues);
  const detailText = typeof body.detailText === "string" ? body.detailText.trim() : "";
  const maxCommentLength = getFeedbackCommentMaxLength();

  if (!threadId || !messageKey || !messageText || !rating) {
    return NextResponse.json({ message: "Missing required feedback fields" }, { status: 400 });
  }

  if (rating === "down" && issues.length === 0) {
    return NextResponse.json({ message: "Please choose at least one issue for negative feedback" }, { status: 400 });
  }

  if (detailText.length > maxCommentLength) {
    return NextResponse.json(
      { message: `Comment exceeds ${maxCommentLength} characters` },
      { status: 400 }
    );
  }

  const thread = await getThreadForUser(identity.userId, threadId);

  const captureConversationContext = shouldCaptureFeedbackConversationContext();
  const headerStore = await nextHeaders();

  let historyResult:
    | Awaited<ReturnType<typeof fetchRasaHistory>>
    | { history: []; error?: string; status?: number } = { history: [] };

  if (captureConversationContext) {
    try {
      historyResult = await fetchRasaHistory({
        headers: headerStore,
        cookies: new Map(req.cookies.getAll().map((cookie) => [cookie.name, cookie.value])),
        userSub: identity.userId,
        threadId,
        includeDebugMetadata: FEEDBACK_DEBUG_MODE,
      });
    } catch (error) {
      console.error("Failed to capture feedback conversation context", error);
      historyResult = {
        history: [],
        error: error instanceof Error ? error.message : "Failed to capture conversation history",
        status: 502,
      };
    }
  }

  let serviceSnapshots: Awaited<ReturnType<typeof collectFeedbackServiceSnapshots>> = [];
  try {
    serviceSnapshots = await collectFeedbackServiceSnapshots();
  } catch (error) {
    console.error("Failed to collect feedback service snapshots", error);
  }

  try {
    const feedbackResult = await createMessageFeedback({
      userId: reporterKey,
      userEmail: null,
      userName: null,
      userAliases: getFeedbackReporterAliases(identity.userId),
      threadId,
      threadName: thread?.name ?? null,
      messageKey,
      messageText,
      rating,
      issues,
      detailText: detailText || null,
      includeConversationContext: captureConversationContext,
      conversationContext: captureConversationContext
        ? {
            disclosure: getFeedbackDisclosureText(),
            history: historyResult.history,
            historyError: "error" in historyResult ? historyResult.error : null,
            historyStatus: "status" in historyResult ? historyResult.status : null,
          }
        : null,
      submissionContext: {
        locale: req.cookies.get("lang")?.value ?? null,
        theme: req.cookies.get("theme")?.value ?? null,
        darkMode: req.cookies.get("dark")?.value === "true",
        pathname: req.nextUrl.pathname,
        submittedAt: new Date().toISOString(),
        threadRegistryMissing: thread == null,
      },
      serviceSnapshots,
    });

    return NextResponse.json(feedbackResult, {
      status: feedbackResult.wasUpdated ? 200 : 201,
    });
  } catch (error) {
    console.error("Failed to persist feedback", error);
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Failed to persist feedback",
      },
      { status: 500 }
    );
  }
}