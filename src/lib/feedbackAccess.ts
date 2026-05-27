import { createHash } from "crypto";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { getFeedbackAdminEmails, getFeedbackAdminRoles } from "@/lib/feedbackConfig";

function decodeJwtPayload(rawToken: string | null | undefined): Record<string, unknown> | null {
  if (!rawToken) return null;

  const parts = rawToken.split(".");
  if (parts.length < 2) return null;

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectRolesFromPayload(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];

  const roleValues = new Set<string>();

  const directRoles = payload.roles;
  if (Array.isArray(directRoles)) {
    for (const value of directRoles) {
      if (typeof value === "string" && value.trim()) {
        roleValues.add(value.trim().toLowerCase());
      }
    }
  }

  const groups = payload.groups;
  if (Array.isArray(groups)) {
    for (const value of groups) {
      if (typeof value === "string" && value.trim()) {
        roleValues.add(value.trim().toLowerCase());
      }
    }
  }

  const realmAccess = payload.realm_access;
  if (realmAccess && typeof realmAccess === "object") {
    const realmRoles = (realmAccess as { roles?: unknown }).roles;
    if (Array.isArray(realmRoles)) {
      for (const value of realmRoles) {
        if (typeof value === "string" && value.trim()) {
          roleValues.add(value.trim().toLowerCase());
        }
      }
    }
  }

  const resourceAccess = payload.resource_access;
  if (resourceAccess && typeof resourceAccess === "object") {
    for (const resourceValue of Object.values(resourceAccess as Record<string, unknown>)) {
      if (!resourceValue || typeof resourceValue !== "object") continue;
      const resourceRoles = (resourceValue as { roles?: unknown }).roles;
      if (!Array.isArray(resourceRoles)) continue;
      for (const value of resourceRoles) {
        if (typeof value === "string" && value.trim()) {
          roleValues.add(value.trim().toLowerCase());
        }
      }
    }
  }

  return [...roleValues];
}

export function getAccessTokenRoles(accessToken: string | null | undefined): string[] {
  return collectRolesFromPayload(decodeJwtPayload(accessToken));
}

function getAccessTokenPayload(accessToken: string | null | undefined): Record<string, unknown> | null {
  return decodeJwtPayload(accessToken);
}

function readStringClaim(payload: Record<string, unknown> | null, keys: string[]): string | null {
  if (!payload) return null;

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function getAccessTokenEmail(accessToken: string | null | undefined): string | null {
  return readStringClaim(getAccessTokenPayload(accessToken), ["email", "upn", "preferred_username"]);
}

export function getAccessTokenName(accessToken: string | null | undefined): string | null {
  return readStringClaim(getAccessTokenPayload(accessToken), ["name", "preferred_username", "given_name"]);
}

function getReporterSalt(): string {
  const reporterSalt = process.env.FEEDBACK_REPORTER_SALT?.trim();
  if (reporterSalt) {
    return reporterSalt;
  }

  throw new Error("Missing FEEDBACK_REPORTER_SALT environment variable");
}

export function createFeedbackReporterKey(userId: string | null | undefined): string | null {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    return null;
  }

  const digest = createHash("sha256")
    .update(`${getReporterSalt()}:${normalizedUserId}`)
    .digest("hex");

  return `anon_${digest.slice(0, 16)}`;
}

export function getFeedbackReporterAliases(userId: string | null | undefined): string[] {
  const normalizedUserId = String(userId ?? "").trim();
  const reporterKey = createFeedbackReporterKey(normalizedUserId);

  return [...new Set([reporterKey, normalizedUserId].filter((value): value is string => Boolean(value)))];
}

export function isFeedbackAdmin(params: {
  email?: string | null;
  accessToken?: string | null;
}): boolean {
  const adminEmails = getFeedbackAdminEmails();
  const adminRoles = getFeedbackAdminRoles();
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

export function getFeedbackIdentityFromToken(token: JWT) {
  const fallbackEmail = getAccessTokenEmail(typeof token.accessToken === "string" ? token.accessToken : null);
  const fallbackName = getAccessTokenName(typeof token.accessToken === "string" ? token.accessToken : null);

  return {
    userId: typeof token.sub === "string" ? token.sub : null,
    userEmail: typeof token.email === "string" ? token.email : fallbackEmail,
    userName: typeof token.name === "string" ? token.name : fallbackName,
    isAdmin: isFeedbackAdmin({
      email: typeof token.email === "string" ? token.email : fallbackEmail,
      accessToken: typeof token.accessToken === "string" ? token.accessToken : null,
    }),
  };
}

export function getFeedbackIdentityFromSession(session: Session | null | undefined) {
  const fallbackEmail = getAccessTokenEmail(session?.accessToken ?? null);
  const fallbackName = getAccessTokenName(session?.accessToken ?? null);

  return {
    userId: session?.user?.id ?? null,
    userEmail: session?.user?.email ?? fallbackEmail,
    userName: session?.user?.name ?? fallbackName,
    isAdmin:
      session?.isFeedbackAdmin === true ||
      isFeedbackAdmin({
        email: session?.user?.email ?? fallbackEmail,
        accessToken: session?.accessToken ?? null,
      }),
  };
}