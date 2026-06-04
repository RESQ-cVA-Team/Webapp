import { afterEach, describe, expect, it } from "vitest";
import {
  createFeedbackReporterKey,
  getFeedbackIdentityFromSession,
  isFeedbackAdmin,
} from "@/lib/feedbackAccess";

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

const ORIGINAL_ENV = {
  FEEDBACK_REPORTER_SALT: process.env.FEEDBACK_REPORTER_SALT,
  FEEDBACK_ADMIN_EMAILS: process.env.FEEDBACK_ADMIN_EMAILS,
  FEEDBACK_ADMIN_ROLES: process.env.FEEDBACK_ADMIN_ROLES,
};

afterEach(() => {
  process.env.FEEDBACK_REPORTER_SALT = ORIGINAL_ENV.FEEDBACK_REPORTER_SALT;
  process.env.FEEDBACK_ADMIN_EMAILS = ORIGINAL_ENV.FEEDBACK_ADMIN_EMAILS;
  process.env.FEEDBACK_ADMIN_ROLES = ORIGINAL_ENV.FEEDBACK_ADMIN_ROLES;
});

describe("feedbackAccess", () => {
  it("creates deterministic reporter keys from the configured salt", () => {
    process.env.FEEDBACK_REPORTER_SALT = "test-salt";

    expect(createFeedbackReporterKey("user-123")).toMatch(/^anon_[0-9a-f]{16}$/);
    expect(createFeedbackReporterKey("   ")).toBeNull();
  });

  it("treats configured admin emails as admins", () => {
    process.env.FEEDBACK_ADMIN_EMAILS = "admin@example.com";
    process.env.FEEDBACK_ADMIN_ROLES = "";

    expect(isFeedbackAdmin({ email: "Admin@Example.com", accessToken: null })).toBe(true);
  });

  it("falls back to roles and token claims when email is missing", () => {
    process.env.FEEDBACK_ADMIN_EMAILS = "";
    process.env.FEEDBACK_ADMIN_ROLES = "realm-admin";

    expect(
      isFeedbackAdmin({
        email: null,
        accessToken: buildJwt({ realm_access: { roles: ["realm-admin"] } }),
      })
    ).toBe(true);
  });

  it("extracts feedback identity from a session and token payload", () => {
    process.env.FEEDBACK_ADMIN_EMAILS = "";
    process.env.FEEDBACK_ADMIN_ROLES = "";

    expect(
      getFeedbackIdentityFromSession({
        accessToken: buildJwt({ email: "token@example.com", name: "Token User" }),
        user: { id: "user-1", email: null, name: null },
      } as never)
    ).toEqual({
      userId: "user-1",
      userEmail: "token@example.com",
      userName: "Token User",
      isAdmin: false,
    });
  });
});