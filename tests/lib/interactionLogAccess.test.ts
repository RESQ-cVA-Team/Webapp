import { afterEach, describe, expect, it } from "vitest";
import {
  createInteractionLogPseudonym,
  getInteractionLogIdentityFromSession,
  isInteractionLogAdmin,
} from "@/lib/interactionLogAccess";

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

const ORIGINAL_ENV = {
  INTERACTION_LOG_PSEUDONYM_SALT: process.env.INTERACTION_LOG_PSEUDONYM_SALT,
  INTERACTION_LOG_ADMIN_EMAILS: process.env.INTERACTION_LOG_ADMIN_EMAILS,
  INTERACTION_LOG_ADMIN_ROLES: process.env.INTERACTION_LOG_ADMIN_ROLES,
  FEEDBACK_ADMIN_EMAILS: process.env.FEEDBACK_ADMIN_EMAILS,
};

afterEach(() => {
  process.env.INTERACTION_LOG_PSEUDONYM_SALT = ORIGINAL_ENV.INTERACTION_LOG_PSEUDONYM_SALT;
  process.env.INTERACTION_LOG_ADMIN_EMAILS = ORIGINAL_ENV.INTERACTION_LOG_ADMIN_EMAILS;
  process.env.INTERACTION_LOG_ADMIN_ROLES = ORIGINAL_ENV.INTERACTION_LOG_ADMIN_ROLES;
  process.env.FEEDBACK_ADMIN_EMAILS = ORIGINAL_ENV.FEEDBACK_ADMIN_EMAILS;
});

describe("interactionLogAccess", () => {
  it("treats configured interaction-log admin emails as admins, independent of feedback's list", () => {
    process.env.INTERACTION_LOG_ADMIN_EMAILS = "admin@example.com";
    process.env.INTERACTION_LOG_ADMIN_ROLES = "";
    process.env.FEEDBACK_ADMIN_EMAILS = "someone-else@example.com";

    expect(isInteractionLogAdmin({ email: "Admin@Example.com", accessToken: null })).toBe(true);
    expect(isInteractionLogAdmin({ email: "someone-else@example.com", accessToken: null })).toBe(false);
  });

  it("falls back to roles and token claims when email is missing", () => {
    process.env.INTERACTION_LOG_ADMIN_EMAILS = "";
    process.env.INTERACTION_LOG_ADMIN_ROLES = "realm-admin";

    expect(
      isInteractionLogAdmin({
        email: null,
        accessToken: buildJwt({ realm_access: { roles: ["realm-admin"] } }),
      })
    ).toBe(true);
  });

  it("extracts interaction-log identity from a session and token payload", () => {
    process.env.INTERACTION_LOG_ADMIN_EMAILS = "";
    process.env.INTERACTION_LOG_ADMIN_ROLES = "";

    expect(
      getInteractionLogIdentityFromSession({
        accessToken: buildJwt({ email: "token@example.com", name: "Token User" }),
        user: { id: "user-1", email: null, name: null },
      } as never)
    ).toEqual({
      userSub: "user-1",
      userEmail: "token@example.com",
      userName: "Token User",
      isAdmin: false,
    });
  });

  it("creates deterministic pseudonyms from the configured salt, distinct from real identity", () => {
    process.env.INTERACTION_LOG_PSEUDONYM_SALT = "test-salt";

    const first = createInteractionLogPseudonym("user-123");
    const second = createInteractionLogPseudonym("user-123");
    const other = createInteractionLogPseudonym("user-456");

    expect(first).toMatch(/^pseudo_[0-9a-f]{16}$/);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(createInteractionLogPseudonym("   ")).toBeNull();
  });

  it("throws a clear error when the pseudonym salt is missing", () => {
    delete process.env.INTERACTION_LOG_PSEUDONYM_SALT;
    expect(() => createInteractionLogPseudonym("user-123")).toThrow(/INTERACTION_LOG_PSEUDONYM_SALT/);
  });
});
