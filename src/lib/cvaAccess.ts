import type { Session } from "next-auth";
import { decodeJwtPayload } from "@/lib/jwtClaims";

/** Set on the session (never thrown) when a signed-in user's token lacks the
 * role required to use cVA at all. */
export const CVA_ROLE_MISSING_ERROR = "MissingCvaRole";

export const NO_ACCESS_PATH = "/auth/no-access";

/** Keycloak realm role a user must hold to use cVA. */
export const REQUIRED_CVA_ROLE = "cva";

// Realm roles only: the top-level `roles` claim this realm's tokens carry and
// the standard `realm_access.roles`. Groups and client roles are excluded so a
// group or client role with the same name cannot grant access.
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

export function getAccessTokenRealmRoles(accessToken: string | null | undefined): string[] {
  const payload = decodeJwtPayload(accessToken);
  return payload ? collectRealmRoles(payload) : [];
}

export function hasRequiredCvaRole(accessToken: string | null | undefined): boolean {
  return getAccessTokenRealmRoles(accessToken).includes(REQUIRED_CVA_ROLE);
}

/** False for no session and for a session whose user lacks the cVA role.
 * Routes that only checked `!session` should use this instead. */
export function isSessionAllowed(session: Session | null | undefined): session is Session {
  return Boolean(session) && session?.error !== CVA_ROLE_MISSING_ERROR;
}
