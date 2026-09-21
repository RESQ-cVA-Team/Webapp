import type { Session } from "next-auth";
import { decodeJwtPayload } from "@/lib/jwtClaims";

/** Set on the session (never thrown) when a signed-in user's token lacks the
 * role required to use cVA at all. */
export const CVA_ROLE_MISSING_ERROR = "MissingCvaRole";

export const NO_ACCESS_PATH = "/auth/no-access";

/** Keycloak realm role a user must hold to use cVA. Read per call so tests
 * and deployments can change it without a module reload. */
export function getRequiredCvaRole(): string {
  return process.env.CVA_REQUIRED_ROLE?.trim().toLowerCase() || "cva";
}

// Realm roles only: the top-level `roles` claim this realm's tokens carry and
// the standard `realm_access.roles`. Deliberately narrower than
// feedbackAccess's getAccessTokenRoles, which also merges groups and client
// roles -- a group or client role named "cva" must not grant access.
function collectRealmRoles(payload: Record<string, unknown>): string[] {
  const roles: string[] = [];

  const pushAll = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) {
        roles.push(entry.trim().toLowerCase());
      }
    }
  };

  pushAll(payload.roles);
  const realmAccess = payload.realm_access;
  if (realmAccess && typeof realmAccess === "object") {
    pushAll((realmAccess as { roles?: unknown }).roles);
  }

  return roles;
}

export function hasRequiredCvaRole(accessToken: string | null | undefined): boolean {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return false;
  return collectRealmRoles(payload).includes(getRequiredCvaRole());
}

/** False for no session and for a session whose user lacks the cVA role.
 * Routes that only checked `!session` should use this instead. */
export function isSessionAllowed(session: Session | null | undefined): session is Session {
  return Boolean(session) && session?.error !== CVA_ROLE_MISSING_ERROR;
}
