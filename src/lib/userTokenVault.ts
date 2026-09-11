import crypto from "node:crypto";
import { createClient } from "redis";

type RedisVaultClient = {
  isOpen: boolean;
  connect(): Promise<RedisVaultClient>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  set(
    key: string,
    value: string,
    options?: { EX?: number; PX?: number; NX?: boolean; XX?: boolean }
  ): Promise<"OK" | null>;
};

type TokenEntry = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: number;
  storedUntil: number;
  refreshedAt?: number;
};

type TokenBackend = "memory" | "redis";

const USER_TOKEN_VAULT_BACKEND = (process.env.USER_TOKEN_VAULT_BACKEND || "memory").trim().toLowerCase() as TokenBackend;
const USER_TOKEN_VAULT_REDIS_URL = (process.env.USER_TOKEN_VAULT_REDIS_URL || "").trim();
const USER_TOKEN_VAULT_REDIS_PREFIX = (process.env.USER_TOKEN_VAULT_REDIS_PREFIX || "cva:user-token:").trim();

const DEFAULT_TTL_MS = Number(process.env.USER_TOKEN_VAULT_TTL_MS ?? 30 * 60 * 1000);

// Fail at boot, not on a live user's first login -- a bad value here
// previously only surfaced as a confusing signin redirect loop once
// someone actually tried to log in.
if (USER_TOKEN_VAULT_BACKEND !== "memory" && USER_TOKEN_VAULT_BACKEND !== "redis") {
  throw new Error(`Unsupported USER_TOKEN_VAULT_BACKEND: ${USER_TOKEN_VAULT_BACKEND}`);
}
if (USER_TOKEN_VAULT_BACKEND === "redis") {
  if (!USER_TOKEN_VAULT_REDIS_URL) {
    throw new Error("USER_TOKEN_VAULT_REDIS_URL must be set when USER_TOKEN_VAULT_BACKEND=redis");
  }
  if (!/^[0-9a-fA-F]{64}$/.test((process.env.USER_TOKEN_VAULT_ENCRYPTION_KEY || "").trim())) {
    throw new Error(
      "USER_TOKEN_VAULT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) when USER_TOKEN_VAULT_BACKEND=redis"
    );
  }
}

const globalForUserTokenVault = globalThis as unknown as {
  userTokenBySub?: Map<string, TokenEntry>;
  userTokenVaultRedisClient?: RedisVaultClient;
};

const tokenBySub = globalForUserTokenVault.userTokenBySub ?? new Map<string, TokenEntry>();

globalForUserTokenVault.userTokenBySub = tokenBySub;

let redisClientPromise: Promise<RedisVaultClient> | null = null;

function now(): number {
  return Date.now();
}

function normalizeSub(sub: string): string {
  return String(sub ?? "").trim();
}

function assertSupportedBackend(): TokenBackend {
  if (USER_TOKEN_VAULT_BACKEND === "memory" || USER_TOKEN_VAULT_BACKEND === "redis") {
    return USER_TOKEN_VAULT_BACKEND;
  }
  throw new Error(`Unsupported USER_TOKEN_VAULT_BACKEND: ${USER_TOKEN_VAULT_BACKEND}`);
}

function assertRedisUrl(): string {
  if (!USER_TOKEN_VAULT_REDIS_URL) {
    throw new Error("USER_TOKEN_VAULT_REDIS_URL must be set when USER_TOKEN_VAULT_BACKEND=redis");
  }
  return USER_TOKEN_VAULT_REDIS_URL;
}

async function getRedisClient(): Promise<RedisVaultClient> {
  if (globalForUserTokenVault.userTokenVaultRedisClient?.isOpen) {
    return globalForUserTokenVault.userTokenVaultRedisClient;
  }

  if (!redisClientPromise) {
    const client = createClient({ url: assertRedisUrl() }) as RedisVaultClient;
    redisClientPromise = client.connect().then(() => {
      globalForUserTokenVault.userTokenVaultRedisClient = client;
      return client;
    });
  }

  return redisClientPromise;
}

function redisKeyForSub(sub: string): string {
  return `${USER_TOKEN_VAULT_REDIS_PREFIX}${sub}`;
}

// Real Keycloak access/refresh tokens used to be stored in Redis as plain
// JSON -- anyone who could read this keyspace (a misconfigured ACL, a
// leaked admin console, a Redis backup) could impersonate any user via
// their refresh token. Encrypted at rest with AES-256-GCM; CVaLab writes
// into this same keyspace directly (server/keycloakAuth.ts) and mirrors
// this exact scheme, so both sides can read what the other wrote.
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_IV_LENGTH = 12;
const ENCRYPTION_AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const hex = (process.env.USER_TOKEN_VAULT_ENCRYPTION_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "USER_TOKEN_VAULT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) when USER_TOKEN_VAULT_BACKEND=redis"
    );
  }
  return Buffer.from(hex, "hex");
}

function encryptForStorage(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decryptFromStorage(stored: string): string {
  const key = getEncryptionKey();
  const raw = Buffer.from(stored, "base64");
  const iv = raw.subarray(0, ENCRYPTION_IV_LENGTH);
  const authTag = raw.subarray(ENCRYPTION_IV_LENGTH, ENCRYPTION_IV_LENGTH + ENCRYPTION_AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(ENCRYPTION_IV_LENGTH + ENCRYPTION_AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

async function readMemoryTokenEntry(sub: string): Promise<TokenEntry | null> {
  const key = normalizeSub(sub);
  if (!key) return null;

  const entry = tokenBySub.get(key);
  if (!entry) return null;

  if (entry.storedUntil <= now()) {
    tokenBySub.delete(key);
    return null;
  }

  return entry;
}

async function readRedisTokenEntry(sub: string): Promise<TokenEntry | null> {
  const key = normalizeSub(sub);
  if (!key) return null;
  const client = await getRedisClient();
  const raw = await client.get(redisKeyForSub(key));
  if (!raw) return null;
  let parsed: TokenEntry;
  try {
    parsed = JSON.parse(decryptFromStorage(raw)) as TokenEntry;
  } catch {
    // Covers both a corrupted entry and a pre-encryption plaintext leftover
    // -- either way, the safe move is to drop it and require a fresh login
    // rather than trust or silently re-use it.
    await client.del(redisKeyForSub(key));
    return null;
  }
  if (parsed.storedUntil <= now()) {
    await client.del(redisKeyForSub(key));
    return null;
  }
  return parsed;
}

async function setMemoryTokenEntry(sub: string, entry: TokenEntry): Promise<void> {
  tokenBySub.set(sub, entry);
}

async function setRedisTokenEntry(sub: string, entry: TokenEntry): Promise<void> {
  const client = await getRedisClient();
  const key = redisKeyForSub(sub);
  const ttlMs = Math.max(1000, entry.storedUntil - now());
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
  await client.set(key, encryptForStorage(JSON.stringify(entry)), { EX: ttlSeconds });
}

async function readTokenEntry(sub: string): Promise<TokenEntry | null> {
  const backend = assertSupportedBackend();
  if (backend === "memory") {
    return readMemoryTokenEntry(sub);
  }
  return readRedisTokenEntry(sub);
}

async function setTokenEntry(sub: string, entry: TokenEntry): Promise<void> {
  const backend = assertSupportedBackend();
  if (backend === "memory") {
    await setMemoryTokenEntry(sub, entry);
    return;
  }
  await setRedisTokenEntry(sub, entry);
}

function computeStoredUntil(expiresAt: number): number {
  return Math.max(expiresAt, now() + DEFAULT_TTL_MS);
}

export async function putUserTokens(params: {
  sub: string;
  accessToken: string;
  refreshToken?: string | null;
  accessTokenExpiresAt?: number;
  accessTokenRefreshedAt?: number;
}): Promise<void> {
  const sub = normalizeSub(params.sub);
  if (!sub || !params.accessToken) return;

  const existingEntry = await readTokenEntry(sub);

  const expiresAt =
    typeof params.accessTokenExpiresAt === "number" && params.accessTokenExpiresAt > now()
      ? params.accessTokenExpiresAt
      : now() + DEFAULT_TTL_MS;

  const entry = {
    accessToken: params.accessToken,
    refreshToken:
      params.refreshToken === undefined
        ? existingEntry?.refreshToken ?? null
        : params.refreshToken,
    expiresAt,
    storedUntil: computeStoredUntil(expiresAt),
    refreshedAt:
      typeof params.accessTokenRefreshedAt === "number"
        ? params.accessTokenRefreshedAt
        : existingEntry?.refreshedAt,
  };

  await setTokenEntry(sub, entry);
}

export async function getUserTokenEntry(sub: string): Promise<TokenEntry | null> {
  return readTokenEntry(sub);
}

export async function getUserAccessToken(sub: string): Promise<string | null> {
  const entry = await readTokenEntry(sub);
  if (entry && entry.expiresAt > now()) {
    return entry.accessToken;
  }

  return null;
}
