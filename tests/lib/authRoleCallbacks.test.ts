import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserAccessTokenMock = vi.hoisted(() => vi.fn());
const getUserTokenEntryMock = vi.hoisted(() => vi.fn());
const putUserTokensMock = vi.hoisted(() => vi.fn());
const ensureFreshUserTokensMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/userTokenVault", () => ({
  getUserAccessToken: getUserAccessTokenMock,
  getUserTokenEntry: getUserTokenEntryMock,
  putUserTokens: putUserTokensMock,
}));
vi.mock("@/lib/userTokenRefresh", () => ({
  ACCESS_TOKEN_REFRESH_SAFETY_MS: 90000,
  ensureFreshUserTokens: ensureFreshUserTokensMock,
}));

import { authConfig } from "@/lib/auth";

type Callbacks = {
  signIn: (params: unknown) => Promise<unknown>;
  jwt: (params: unknown) => Promise<Record<string, unknown>>;
  session: (params: unknown) => Promise<Record<string, unknown>>;
};
const callbacks = authConfig.callbacks as unknown as Callbacks;

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

const WITH_ROLE = buildJwt({ roles: ["cva"] });
const WITHOUT_ROLE = buildJwt({ roles: ["default-roles-stroke"] });
const FAR_FUTURE = Date.now() + 60 * 60 * 1000;

beforeEach(() => {
  getUserAccessTokenMock.mockReset();
  getUserTokenEntryMock.mockReset();
  putUserTokensMock.mockReset();
  ensureFreshUserTokensMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("signIn callback", () => {
  it("lets a user with the cVA role sign in", async () => {
    await expect(callbacks.signIn({ account: { access_token: WITH_ROLE }, profile: { sub: "u1" } })).resolves.toBe(true);
  });

  it("sends a user without the role to the no-access page", async () => {
    await expect(callbacks.signIn({ account: { access_token: WITHOUT_ROLE }, profile: { sub: "u1" } })).resolves.toBe(
      "/auth/no-access"
    );
  });

  it("sends a sign-in with no access token to the no-access page", async () => {
    await expect(callbacks.signIn({ account: {}, profile: {} })).resolves.toBe("/auth/no-access");
    await expect(callbacks.signIn({})).resolves.toBe("/auth/no-access");
  });
});

describe("jwt callback role tracking", () => {
  function tokenOutsideRefreshWindow() {
    return { sub: "u1", email: "u@example.com", accessTokenExpires: FAR_FUTURE };
  }

  it("marks the user as having the role from the vaulted access token", async () => {
    getUserAccessTokenMock.mockResolvedValue(WITH_ROLE);
    const token = await callbacks.jwt({ token: tokenOutsideRefreshWindow() });
    expect(token.hasCvaRole).toBe(true);
  });

  it("marks the user as lacking the role when the vaulted token no longer carries it", async () => {
    getUserAccessTokenMock.mockResolvedValue(WITHOUT_ROLE);
    const token = await callbacks.jwt({ token: { ...tokenOutsideRefreshWindow(), hasCvaRole: true } });
    expect(token.hasCvaRole).toBe(false);
  });

  it("keeps the previous verdict when there is no vaulted token to read", async () => {
    getUserAccessTokenMock.mockResolvedValue(null);
    const token = await callbacks.jwt({ token: { ...tokenOutsideRefreshWindow(), hasCvaRole: true } });
    expect(token.hasCvaRole).toBe(true);
  });

  it("re-reads the role from the refreshed token, so a revoked role shows up on refresh", async () => {
    getUserAccessTokenMock.mockResolvedValue(WITH_ROLE);
    ensureFreshUserTokensMock.mockResolvedValue({
      accessToken: WITHOUT_ROLE,
      expiresAt: FAR_FUTURE,
      refreshed: true,
    });

    const token = await callbacks.jwt({
      token: { sub: "u1", accessTokenExpires: Date.now() - 1000, hasCvaRole: true },
    });

    expect(ensureFreshUserTokensMock).toHaveBeenCalledWith("u1");
    expect(token.hasCvaRole).toBe(false);
    expect(token.error).toBeUndefined();
  });

  it("reports a refresh failure as the refresh error, not as a missing role", async () => {
    getUserAccessTokenMock.mockResolvedValue(null);
    ensureFreshUserTokensMock.mockResolvedValue(null);

    const token = await callbacks.jwt({
      token: { sub: "u1", accessTokenExpires: Date.now() - 1000, hasCvaRole: true },
    });

    expect(token.error).toBe("RefreshAccessTokenError");
    expect(token.hasCvaRole).toBe(true);
  });
});

describe("session callback role enforcement", () => {
  const baseSession = () => ({ user: { name: "U", email: "u@example.com" }, expires: "" });

  beforeEach(() => {
    getUserAccessTokenMock.mockResolvedValue(WITH_ROLE);
    getUserTokenEntryMock.mockResolvedValue({ refreshedAt: 1 });
  });

  it("gives a user with the role a normal session", async () => {
    const session = (await callbacks.session({
      session: baseSession(),
      token: { sub: "u1", hasCvaRole: true },
    })) as { user: { id?: string }; accessToken?: string; error?: string };

    expect(session.user.id).toBe("u1");
    expect(session.accessToken).toBe(WITH_ROLE);
    expect(session.error).toBeUndefined();
  });

  it("treats an unknown verdict like a normal session", async () => {
    const session = (await callbacks.session({
      session: baseSession(),
      token: { sub: "u1" },
    })) as { user: { id?: string }; error?: string };

    expect(session.user.id).toBe("u1");
    expect(session.error).toBeUndefined();
  });

  it("strips the identity and token from a user known to lack the role", async () => {
    const session = (await callbacks.session({
      session: baseSession(),
      token: { sub: "u1", hasCvaRole: false, isFeedbackAdmin: true },
    })) as { user: { id?: string; email?: string }; accessToken?: string; isFeedbackAdmin?: boolean; error?: string };

    expect(session.user.id).toBeUndefined();
    expect(session.accessToken).toBeUndefined();
    expect(session.isFeedbackAdmin).toBe(false);
    expect(session.error).toBe("MissingCvaRole");
    expect(session.user.email).toBe("u@example.com");
  });
});
