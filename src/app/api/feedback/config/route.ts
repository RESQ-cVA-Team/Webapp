import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  FEEDBACK_ISSUE_OPTIONS,
  getFeedbackCommentMaxLength,
  getFeedbackDisclosureText,
  isFeedbackAdminEnabled,
  isMessageFeedbackEnabled,
  shouldCaptureFeedbackConversationContext,
} from "@/lib/feedbackConfig";
import { getFeedbackIdentityFromSession } from "@/lib/feedbackAccess";
import { getFeedbackStorageInfo } from "@/lib/feedbackStore";

export async function GET() {
  const session = await auth();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const storage = getFeedbackStorageInfo();

  return NextResponse.json({
    enabled: isMessageFeedbackEnabled(),
    adminEnabled: isFeedbackAdminEnabled(),
    canViewAdmin: getFeedbackIdentityFromSession(session).isAdmin,
    captureConversationContext: shouldCaptureFeedbackConversationContext(),
    commentMaxLength: getFeedbackCommentMaxLength(),
    disclosure: getFeedbackDisclosureText(),
    issues: FEEDBACK_ISSUE_OPTIONS,
    storageMode: storage.kind,
    storageDescription: storage.description,
    storageWarning: storage.warning,
  });
}