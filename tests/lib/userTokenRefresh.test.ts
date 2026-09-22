import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserTokenEntryMock = vi.hoisted(() => vi.fn());
const putUserTokensMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth.config", () => ({ keycloakIssuer: "https://kc.test/realms/cva" }));
vi.mock("@/lib/userTokenVault", () => ({
  getUserTokenEntry: getUserTokenEntryMock,
  putUserTokens: putUserTokensMock,
}));
vi.stubGlobal("fetch", fetchMock);

import { ensureFreshUserTokens, getFreshUserAccessToken } from "@/lib/userTokenRefresh";

const NOW = 1_800_000_000_000;

function entry(overrides: Partial<{ accessToken: string; refreshToken: string | null; expiresAt: number }> = {}) {
  return {
    accessToken: "vault-access",
    refreshToken: "vault-refresh",
    expiresAt: NOW + 10 * 60 * 1000,
    storedUntil: NOW + 60 * 60 * 1000,
    ...overrides,
  };
}

function keycloakOk(body: Record<string, unknown>) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getUserTokenEntryMock.mockReset();
  putUserTokensMock.mockReset();
  putUserTokensMock.mockResolvedValue(undefined);
  fetchMock.mockReset();
  process.env.KEYCLOAK_CLIENT_ID = "cva";
  process.env.KEYCLOAK_CLIENT_SECRET = "secret";
});

describe("ensureFreshUserTokens", () => {
  it("returns null for a blank sub without touching the vault", async () => {
    expect(await ensureFreshUserTokens("  ")).toBeNull();
    expect(getUserTokenEntryMock).not.toHaveBeenCalled();
  });

  it("returns null when nothing is vaulted for the user", async () => {
    getUserTokenEntryMock.mockResolvedValue(null);
    expect(await ensureFreshUserTokens("u1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the vaulted token untouched while it is outside the safety margin", async () => {
    getUserTokenEntryMock.mockResolvedValue(entry());

    const result = await ensureFreshUserTokens("u1");

    expect(result).toEqual({
      accessToken: "vault-access",
      expiresAt: NOW + 10 * 60 * 1000,
      refreshed: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token, stores the result, and keeps a rotated refresh token", async () => {
    getUserTokenEntryMock.mockResolvedValue(entry({ expiresAt: NOW - 1000 }));
    fetchMock.mockResolvedValue(
      keycloakOk({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 300 })
    );

    const result = await ensureFreshUserTokens("u1");

    expect(result).toEqual({ accessToken: "new-access", expiresAt: NOW + 300_000, refreshed: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: URLSearchParams }];
    expect(url).toBe("https://kc.test/realms/cva/protocol/openid-connect/token");
    expect(init.body.get("grant_type")).toBe("refresh_token");
    expect(init.body.get("refresh_token")).toBe("vault-refresh");
    expect(putUserTokensMock).toHaveBeenCalledWith({
      sub: "u1",
      accessToken: "new-access",
      refreshToken: "new-refresh",
      accessTokenExpiresAt: NOW + 300_000,
      accessTokenRefreshedAt: NOW,
    });
  });

  it("keeps the existing refresh token when Keycloak does not rotate it", async () => {
    getUserTokenEntryMock.mockResolvedValue(entry({ expiresAt: NOW + 30_000 }));
    fetchMock.mockResolvedValue(keycloakOk({ access_token: "new-access", expires_in: 300 }));

    await ensureFreshUserTokens("u1");

    expect(putUserTokensMock).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "vault-refresh" })
    );
  });

  it("returns null when the token is expired and there is no refresh token", async () => {
    getUserTokenEntryMock.mockResolvedValue(entry({ expiresAt: NOW - 1000, refreshToken: null }));
    expect(await ensureFreshUserTokens("u1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null and stores nothing when Keycloak rejects the refresh", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getUserTokenEntryMock.mockResolvedValue(entry({ expiresAt: NOW - 1000 }));
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "invalid_grant" }),
    });

    expect(await ensureFreshUserTokens("u1")).toBeNull();
    expect(putUserTokensMock).not.toHaveBeenCalled();
  });

  it("returns null when the response has no usable access token", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getUserTokenEntryMock.mockResolvedValue(entry({ expiresAt: NOW - 1000 }));
    fetchMock.mockResolvedValue(keycloakOk({ expires_in: 300 }));

    expect(await ensureFreshUserTokens("u1")).toBeNull();
    expect(putUserTokensMock).not.toHaveBeenCalled();
  });

  it("coalesces concurrent refreshes for the same user into one grant", async () => {
    getUserTokenEntryMock.mockResolvedValue(entry({ expiresAt: NOW - 1000 }));
    let release: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const first = ensureFreshUserTokens("u1");
    const second = ensureFreshUserTokens("u1");
    release(keycloakOk({ access_token: "new-access", expires_in: 300 }));

    const [a, b] = await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("does not coalesce refreshes for different users", async () => {
    getUserTokenEntryMock.mockResolvedValue(entry({ expiresAt: NOW - 1000 }));
    fetchMock.mockResolvedValue(keycloakOk({ access_token: "new-access", expires_in: 300 }));

    await Promise.all([ensureFreshUserTokens("u1"), ensureFreshUserTokens("u2")]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getFreshUserAccessToken", () => {
  it("returns just the access token string, or null", async () => {
    getUserTokenEntryMock.mockResolvedValueOnce(entry());
    expect(await getFreshUserAccessToken("u1")).toBe("vault-access");

    getUserTokenEntryMock.mockResolvedValueOnce(null);
    expect(await getFreshUserAccessToken("u1")).toBeNull();
  });
});
