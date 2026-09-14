import { createHash } from "crypto";
import type { Session } from "next-auth";
import { getAccessTokenEmail, getAccessTokenName, getAccessTokenRoles } from "@/lib/feedbackAccess";
import { getInteractionLogAdminEmails, getInteractionLogAdminRoles } from "@/lib/interactionLogConfig";

/** Deliberately separate from feedback's admin list -- this feature exposes
 * full raw conversations tied to real identities, a more sensitive scope
 * than aggregate thumbs feedback, so not every feedback-admin should
 * automatically see it. */
export function isInteractionLogAdmin(params: { email?: string | null; accessToken?: string | null }): boolean {
  const adminEmails = getInteractionLogAdminEmails();
  const adminRoles = getInteractionLogAdminRoles();
  const fallbackEmail = getAccessTokenEmail(params.accessToken);
  const normalizedEmail = (params.email ?? fallbackEmail)?.trim().toLowerCase() ?? "";

  if (normalizedEmail && adminEmails.includes(normalizedEmail)) {
    return true;
  }

  if (adminRoles.length === 0) {
    return false;
  }

  const tokenRoles = getAccessTokenRoles(params.accessToken);
  return tokenRoles.some((role) => adminRoles.includes(role));
}

export function getInteractionLogIdentityFromSession(session: Session | null | undefined) {
  const fallbackEmail = getAccessTokenEmail(session?.accessToken ?? null);
  const fallbackName = getAccessTokenName(session?.accessToken ?? null);

  return {
    userSub: session?.user?.id ?? null,
    userEmail: session?.user?.email ?? fallbackEmail,
    userName: session?.user?.name ?? fallbackName,
    isAdmin: isInteractionLogAdmin({
      email: session?.user?.email ?? fallbackEmail,
      accessToken: session?.accessToken ?? null,
    }),
  };
}

function getPseudonymSalt(): string {
  const salt = process.env.INTERACTION_LOG_PSEUDONYM_SALT?.trim();
  if (salt) {
    return salt;
  }

  throw new Error("Missing INTERACTION_LOG_PSEUDONYM_SALT environment variable");
}

/** Same salted-hash shape as feedback's createFeedbackReporterKey, but its
 * own separate salt -- entries from the same person are still correlatable
 * across turns (same input always hashes the same) without the stored row
 * revealing who they are. Only called when storage_identity_mode is
 * "pseudonymous"; throws a clear config error if the salt isn't set rather
 * than silently falling back to something weaker. */
export function createInteractionLogPseudonym(userSub: string | null | undefined): string | null {
  const normalized = String(userSub ?? "").trim();
  if (!normalized) {
    return null;
  }

  const digest = createHash("sha256").update(`${getPseudonymSalt()}:${normalized}`).digest("hex");
  return `pseudo_${digest.slice(0, 16)}`;
}
