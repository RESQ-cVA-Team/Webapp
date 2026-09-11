import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal in-memory fake standing in for the real redis client, so these
// tests exercise the actual encrypt/decrypt code path (not a mock of it)
// without needing a real Redis connection.
const fakeStore = new Map<string, string>();
const fakeRedisClient = {
  isOpen: true,
  connect: vi.fn(async () => fakeRedisClient),
  get: vi.fn(async (key: string) => fakeStore.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    fakeStore.set(key, value);
    return "OK" as const;
  }),
  del: vi.fn(async (key: string) => (fakeStore.delete(key) ? 1 : 0)),
};

vi.mock("redis", () => ({
  createClient: vi.fn(() => fakeRedisClient),
}));

const VALID_KEY = "a".repeat(64); // 32 bytes hex

async function freshModule() {
  vi.resetModules();
  return import("@/lib/userTokenVault");
}

describe("userTokenVault (redis backend, encryption at rest)", () => {
  beforeEach(() => {
    fakeStore.clear();
    vi.clearAllMocks();
    process.env.USER_TOKEN_VAULT_BACKEND = "redis";
    process.env.USER_TOKEN_VAULT_REDIS_URL = "redis://localhost:6379";
    process.env.USER_TOKEN_VAULT_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.USER_TOKEN_VAULT_BACKEND;
    delete process.env.USER_TOKEN_VAULT_REDIS_URL;
    delete process.env.USER_TOKEN_VAULT_ENCRYPTION_KEY;
  });

  it("round-trips a token through Redis via encrypt/decrypt", async () => {
    const { putUserTokens, getUserAccessToken } = await freshModule();

    await putUserTokens({
      sub: "user-1",
      accessToken: "real-access-token-value",
      refreshToken: "real-refresh-token-value",
      accessTokenExpiresAt: Date.now() + 60_000,
    });

    const token = await getUserAccessToken("user-1");
    expect(token).toBe("real-access-token-value");
  });

  it("never stores the plaintext token value in Redis", async () => {
    const { putUserTokens } = await freshModule();

    await putUserTokens({
      sub: "user-2",
      accessToken: "super-secret-access-token",
      refreshToken: "super-secret-refresh-token",
      accessTokenExpiresAt: Date.now() + 60_000,
    });

    const stored = [...fakeStore.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toContain("super-secret-access-token");
    expect(stored[0]).not.toContain("super-secret-refresh-token");
  });

  it("drops a corrupted or pre-encryption plaintext entry instead of trusting it", async () => {
    const { getUserAccessToken } = await freshModule();

    // Simulates a leftover plaintext entry from before encryption was added.
    fakeStore.set("cva:user-token:user-3", JSON.stringify({
      accessToken: "old-plaintext-token",
      expiresAt: Date.now() + 60_000,
      storedUntil: Date.now() + 60_000,
    }));

    const token = await getUserAccessToken("user-3");
    expect(token).toBeNull();
    expect(fakeStore.has("cva:user-token:user-3")).toBe(false);
  });

  it("throws at load time when USER_TOKEN_VAULT_ENCRYPTION_KEY is missing", async () => {
    delete process.env.USER_TOKEN_VAULT_ENCRYPTION_KEY;

    // Validated eagerly now (fail at boot, not on a live user's first
    // login) -- the module itself fails to load, not a later call.
    await expect(freshModule()).rejects.toThrow(/USER_TOKEN_VAULT_ENCRYPTION_KEY/);
  });

  it("throws at load time when USER_TOKEN_VAULT_ENCRYPTION_KEY is not valid 32-byte hex", async () => {
    process.env.USER_TOKEN_VAULT_ENCRYPTION_KEY = "not-hex-and-wrong-length";

    await expect(freshModule()).rejects.toThrow(/USER_TOKEN_VAULT_ENCRYPTION_KEY/);
  });
});
