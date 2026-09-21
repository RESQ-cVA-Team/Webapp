import { afterEach, describe, expect, it } from "vitest";
import { hasRequiredCvaRole, isSessionAllowed, CVA_ROLE_MISSING_ERROR } from "@/lib/cvaAccess";

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

const ORIGINAL_ROLE = process.env.CVA_REQUIRED_ROLE;
afterEach(() => {
  if (ORIGINAL_ROLE === undefined) delete process.env.CVA_REQUIRED_ROLE;
  else process.env.CVA_REQUIRED_ROLE = ORIGINAL_ROLE;
});

describe("hasRequiredCvaRole", () => {
  it("accepts the role in the top-level roles claim this realm emits", () => {
    const token = buildJwt({ roles: ["default-roles-stroke", "offline_access", "uma_authorization", "cva"] });
    expect(hasRequiredCvaRole(token)).toBe(true);
  });

  it("accepts the role in realm_access.roles", () => {
    expect(hasRequiredCvaRole(buildJwt({ realm_access: { roles: ["cva"] } }))).toBe(true);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(hasRequiredCvaRole(buildJwt({ roles: [" CVA "] }))).toBe(true);
  });

  it("rejects a token without the role", () => {
    expect(hasRequiredCvaRole(buildJwt({ roles: ["default-roles-stroke", "offline_access"] }))).toBe(false);
  });

  it("does not treat a similarly named role as the role", () => {
    expect(hasRequiredCvaRole(buildJwt({ roles: ["cva-admin", "not-cva", "cva2"] }))).toBe(false);
  });

  it("does not accept a group or client role named cva", () => {
    expect(hasRequiredCvaRole(buildJwt({ groups: ["cva"] }))).toBe(false);
    expect(hasRequiredCvaRole(buildJwt({ resource_access: { account: { roles: ["cva"] } } }))).toBe(false);
  });

  it("rejects missing, malformed, and non-array role claims", () => {
    expect(hasRequiredCvaRole(null)).toBe(false);
    expect(hasRequiredCvaRole(undefined)).toBe(false);
    expect(hasRequiredCvaRole("not-a-jwt")).toBe(false);
    expect(hasRequiredCvaRole(buildJwt({ roles: "cva" }))).toBe(false);
    expect(hasRequiredCvaRole(buildJwt({}))).toBe(false);
  });

  it("uses the configured role name instead of the default", () => {
    process.env.CVA_REQUIRED_ROLE = "Trial-Users";
    expect(hasRequiredCvaRole(buildJwt({ roles: ["cva"] }))).toBe(false);
    expect(hasRequiredCvaRole(buildJwt({ roles: ["trial-users"] }))).toBe(true);
  });

  it("falls back to cva when the setting is blank", () => {
    process.env.CVA_REQUIRED_ROLE = "   ";
    expect(hasRequiredCvaRole(buildJwt({ roles: ["cva"] }))).toBe(true);
  });
});

describe("isSessionAllowed", () => {
  it("rejects no session and a role-less session, accepts a normal one", () => {
    expect(isSessionAllowed(null)).toBe(false);
    expect(isSessionAllowed(undefined)).toBe(false);
    expect(isSessionAllowed({ user: {}, expires: "", error: CVA_ROLE_MISSING_ERROR })).toBe(false);
    expect(isSessionAllowed({ user: { id: "u1" }, expires: "" })).toBe(true);
    expect(isSessionAllowed({ user: { id: "u1" }, expires: "", error: "RefreshAccessTokenError" })).toBe(true);
  });
});
