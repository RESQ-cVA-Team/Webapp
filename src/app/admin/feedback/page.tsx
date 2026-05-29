import { notFound } from "next/navigation";
import { auth } from "@/auth";
import FeedbackAdminView from "@/components/feedback/feedback-admin-view";
import { getFeedbackIdentityFromSession } from "@/lib/feedbackAccess";
import { FEEDBACK_ISSUE_OPTIONS, isFeedbackAdminEnabled, isMessageFeedbackEnabled } from "@/lib/feedbackConfig";
import { getFeedbackStorageInfo } from "@/lib/feedbackStore";

export default async function FeedbackAdminPage() {
  if (!isMessageFeedbackEnabled() || !isFeedbackAdminEnabled()) {
    notFound();
  }

  const session = await auth();
  const identity = getFeedbackIdentityFromSession(session);

  if (!identity.isAdmin) {
    notFound();
  }

  const storage = getFeedbackStorageInfo();

  return (
    <FeedbackAdminView
      issueOptions={[...FEEDBACK_ISSUE_OPTIONS]}
      storageMode={storage.kind}
      storageDescription={storage.description}
      storageWarning={storage.warning}
    />
  );
}