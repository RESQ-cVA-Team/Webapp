import { notFound } from "next/navigation";
import { auth } from "@/auth";
import InteractionLogAdminView from "@/components/interaction-log/interaction-log-admin-view";
import { getInteractionLogIdentityFromSession } from "@/lib/interactionLogAccess";
import { isInteractionLogEnabled } from "@/lib/interactionLogConfig";
import { getInteractionLogEntryStorageInfo } from "@/lib/interactionLogStore";

export default async function InteractionLogAdminPage() {
  if (!isInteractionLogEnabled()) {
    notFound();
  }

  const session = await auth();
  const identity = getInteractionLogIdentityFromSession(session);

  if (!identity.isAdmin) {
    notFound();
  }

  const storage = getInteractionLogEntryStorageInfo();

  // The root layout hides overflow, so the page scrolls its own content.
  return (
    <div className="h-full overflow-y-auto">
      <InteractionLogAdminView
        storageMode={storage.kind}
        storageDescription={storage.description}
        storageWarning={storage.warning}
      />
    </div>
  );
}
