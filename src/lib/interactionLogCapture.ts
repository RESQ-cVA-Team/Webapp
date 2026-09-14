import { createHash } from "crypto";
import type { RasaHistoryItem } from "@/lib/rasaHistory";
import { collectFeedbackServiceSnapshots } from "@/lib/serviceVersionCollector";
import { getAccessTokenEmail, getAccessTokenName } from "@/lib/feedbackAccess";
import { createInteractionLogPseudonym } from "@/lib/interactionLogAccess";
import { isInteractionLogEnabled } from "@/lib/interactionLogConfig";
import { getInteractionLogSettingsCached } from "@/lib/interactionLogSettingsCache";
import { upsertInteractionLogEntry } from "@/lib/interactionLogStore";
import type { InteractionLogSettings } from "@/lib/interactionLogSettingsStore";
import { getUserAccessToken } from "@/lib/userTokenVault";
import { parseRasaSenderId } from "@/lib/rasaSender";

export function resolveInteractionLogDecision(settings: InteractionLogSettings, email: string): boolean {
  switch (settings.mode) {
    case "everyone":
      return !settings.denylistEmails.includes(email);
    case "allowlist":
      return settings.allowlistEmails.includes(email);
    case "denylist":
      return !settings.denylistEmails.includes(email);
    case "percentage":
      if (settings.denylistEmails.includes(email)) return false;
      return isSampledIn(email, settings.samplePercentage);
    default:
      return false;
  }
}

/** Stable per-email bucketing, not per-message randomness -- the same user
 * is always consistently in or out, independent of thread/session. Uses a
 * fixed literal salt, deliberately independent of FEEDBACK_REPORTER_SALT
 * and INTERACTION_LOG_PSEUDONYM_SALT (this is a sampling bucket, not a
 * pseudonym -- reversibility isn't a concern here). */
export function isSampledIn(email: string, percentage: number): boolean {
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;

  const digest = createHash("sha256").update(`interaction-log-sample:${email.trim().toLowerCase()}`).digest();
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket < percentage;
}

/** The long-task-callback route has no live session -- userSub is derived
 * from senderId, and the real email/name are resolved via the same token
 * vault Webapp already populates on every /api/rasa POST
 * (putUserTokens) and the same JWT-claim helpers feedback already uses. If
 * the token has since expired/been evicted, this degrades to nulls, which
 * the capture helper's own "no email -> skip" step already treats as a
 * safe no-op. */
export async function resolveLongTaskCallbackIdentity(
  senderId: string
): Promise<{ userSub: string | null; userEmail: string | null; userName: string | null; threadId: number | null }> {
  const parsed = parseRasaSenderId(senderId);
  if (!parsed?.userSub) {
    return { userSub: null, userEmail: null, userName: null, threadId: null };
  }

  const accessToken = await getUserAccessToken(parsed.userSub);
  return {
    userSub: parsed.userSub,
    userEmail: getAccessTokenEmail(accessToken),
    userName: getAccessTokenName(accessToken),
    threadId: parsed.threadId,
  };
}

export type LogCompletedTurnParams = {
  senderId: string;
  userSub: string | null;
  userEmail: string | null;
  userName: string | null;
  threadId: number | null;
  items: RasaHistoryItem[];
  traceId: string | null;
  source: "sync" | "long-task-callback";
};

/** The single shared capture entry point both Rasa routes call. Never
 * throws -- a capture failure must never affect the chat response, exactly
 * like collectFeedbackServiceSnapshots() failures are already non-fatal in
 * /api/feedback/route.ts. Fire with `void`, don't await on the response
 * path. */
export async function logCompletedTurnIfEnabled(params: LogCompletedTurnParams): Promise<void> {
  try {
    if (!isInteractionLogEnabled()) return;

    const settings = await getInteractionLogSettingsCached();
    if (!settings.masterEnabled) return;

    if (!params.userEmail) return;
    const email = params.userEmail.trim().toLowerCase();

    if (!resolveInteractionLogDecision(settings, email)) return;

    if (!Array.isArray(params.items) || params.items.length === 0) return;

    const serviceSnapshots = await collectFeedbackServiceSnapshots().catch(() => []);

    const identityFields =
      settings.storageIdentityMode === "pseudonymous"
        ? {
            userSub: null,
            userEmail: null,
            userName: null,
            userPseudonym: createInteractionLogPseudonym(params.userSub),
          }
        : {
            userSub: params.userSub,
            userEmail: email,
            userName: params.userName,
            userPseudonym: null,
          };

    await upsertInteractionLogEntry({
      identityMode: settings.storageIdentityMode,
      ...identityFields,
      threadId: params.threadId,
      senderId: params.senderId,
      source: params.source,
      traceId: params.traceId,
      history: params.items,
      serviceSnapshots,
      retentionDays: settings.retentionDays,
    });
  } catch (error) {
    console.error("[interaction-log] Failed to capture turn (non-fatal)", error);
  }
}
