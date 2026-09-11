import { randomUUID } from "crypto";
import { createClient } from "redis";
import type { RasaHistoryItem } from "@/lib/rasaHistory";

type Subscriber = (payload: unknown) => void;

type BufferedPayload = {
  payload: unknown;
  timestamp: number;
};

// Narrow, hand-written interface (matches the pattern already used by
// userTokenVault.ts/kvStore.ts) rather than node-redis's own
// RedisClientType -- the full generic type doesn't assign cleanly onto a
// globalThis-cached field across separate `createClient()` call sites.
type RedisSseBusClient = {
  isOpen: boolean;
  connect(): Promise<unknown>;
  duplicate(): RedisSseBusClient;
  on(event: "error", listener: (err: unknown) => void): void;
  publish(channel: string, message: string): Promise<number>;
  pSubscribe(pattern: string, listener: (message: string, channel: string) => void): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  zAdd(key: string, entry: { score: number; value: string }): Promise<unknown>;
  zRemRangeByScore(key: string, min: number | string, max: number | string): Promise<unknown>;
  zRemRangeByRank(key: string, start: number, stop: number): Promise<unknown>;
  zRangeByScore(key: string, min: number | string, max: number | string): Promise<string[]>;
};

// Local delivery targets (the actual open SSE HTTP connections) are always
// process-local -- an SSE response stream can only ever be written to by
// the process holding it, no backend choice changes that. What the backend
// choice changes is how a publish on one process reaches subscribers on a
// *different* process: "memory" only ever delivers within the same
// process (fine for a single Webapp instance, silently drops
// cross-instance delivery otherwise); "redis" publishes to a shared
// channel every instance listens on, so it works correctly no matter which
// instance a given publish or a given subscriber landed on.
const globalForSseBus = globalThis as unknown as {
  sseSubscribersBySender?: Map<string, Set<Subscriber>>;
  sseBufferedPayloadsBySender?: Map<string, BufferedPayload[]>;
  sseCommittedCursorBySender?: Map<string, number>;
  sseBusRedisClient?: RedisSseBusClient;
  sseBusRedisSubscriber?: RedisSseBusClient;
  sseBusRedisReady?: Promise<void>;
};

const subscribersBySender = globalForSseBus.sseSubscribersBySender ?? new Map<string, Set<Subscriber>>();
globalForSseBus.sseSubscribersBySender = subscribersBySender;

// Memory-backend-only state (Redis backend keeps the equivalent state in
// Redis itself -- see below).
const bufferedPayloadsBySender =
  globalForSseBus.sseBufferedPayloadsBySender ?? new Map<string, BufferedPayload[]>();
const committedCursorBySender =
  globalForSseBus.sseCommittedCursorBySender ?? new Map<string, number>();
globalForSseBus.sseBufferedPayloadsBySender = bufferedPayloadsBySender;
globalForSseBus.sseCommittedCursorBySender = committedCursorBySender;

const MAX_BUFFERED_PAYLOADS_PER_SENDER = 20;
const BUFFER_TTL_MS = 15000;
const BUFFER_KEY_EXPIRE_SECONDS = 60;

const SSE_BUS_BACKEND = (process.env.SSE_BUS_BACKEND || "memory").trim().toLowerCase();
const SSE_BUS_REDIS_URL = (process.env.SSE_BUS_REDIS_URL || "").trim();
const REDIS_CHANNEL_PREFIX = "cva:sse:chan:";
const REDIS_BUFFER_KEY_PREFIX = "cva:sse:buf:";
const REDIS_CURSOR_KEY_PREFIX = "cva:sse:cursor:";

// Fail at boot, not on the first live SSE connection that actually needs
// cross-instance delivery.
if (SSE_BUS_BACKEND !== "memory" && SSE_BUS_BACKEND !== "redis") {
  throw new Error(`Unsupported SSE_BUS_BACKEND: ${SSE_BUS_BACKEND}`);
}
if (SSE_BUS_BACKEND === "redis" && !SSE_BUS_REDIS_URL) {
  throw new Error("SSE_BUS_REDIS_URL must be set when SSE_BUS_BACKEND=redis");
}

function isRedisBackend(): boolean {
  return SSE_BUS_BACKEND === "redis";
}

function normalizeSenderId(senderId: string): string {
  return String(senderId ?? "").trim();
}

function now(): number {
  return Date.now();
}

// --- Redis connection setup (lazy, cached on globalThis like the other
// Redis-backed stores in this codebase) ---------------------------------

function assertRedisUrl(): string {
  if (!SSE_BUS_REDIS_URL) {
    throw new Error("SSE_BUS_REDIS_URL must be set when SSE_BUS_BACKEND=redis");
  }
  return SSE_BUS_REDIS_URL;
}

function dispatchToLocalSubscribers(senderId: string, payload: unknown): void {
  const set = subscribersBySender.get(senderId);
  if (!set) return;
  for (const subscriber of set) {
    try {
      subscriber(payload);
    } catch (err) {
      console.error("SSE subscriber error for sender", senderId, err);
    }
  }
}

async function ensureRedisReady(): Promise<void> {
  if (globalForSseBus.sseBusRedisReady) return globalForSseBus.sseBusRedisReady;

  globalForSseBus.sseBusRedisReady = (async () => {
    const url = assertRedisUrl();
    const client = createClient({ url }) as RedisSseBusClient;
    client.on("error", (err) => console.error("[sseBus] Redis client error", err));
    await client.connect();
    globalForSseBus.sseBusRedisClient = client;

    // A client used for (p)subscribe can't run other commands, so the
    // subscriber lives on its own dedicated connection. One pattern
    // subscription covers every sender -- no per-sender subscribe/
    // unsubscribe bookkeeping needed as local SSE connections come and go.
    const subscriber = client.duplicate();
    subscriber.on("error", (err) => console.error("[sseBus] Redis subscriber error", err));
    await subscriber.connect();
    await subscriber.pSubscribe(`${REDIS_CHANNEL_PREFIX}*`, (message, channel) => {
      const senderId = channel.slice(REDIS_CHANNEL_PREFIX.length);
      try {
        dispatchToLocalSubscribers(senderId, JSON.parse(message));
      } catch (err) {
        console.error("[sseBus] Failed to parse pub/sub message for sender", senderId, err);
      }
    });
    globalForSseBus.sseBusRedisSubscriber = subscriber;
  })();

  return globalForSseBus.sseBusRedisReady;
}

async function getRedisClient(): Promise<RedisSseBusClient> {
  await ensureRedisReady();
  // Non-null: ensureRedisReady's promise only resolves after this is set.
  return globalForSseBus.sseBusRedisClient!;
}

// --- Buffered-payload replay (closes the race between a message being
// published and a client's SSE connection actually being established) --

async function pruneAndReadBufferedPayloads(senderId: string): Promise<unknown[]> {
  const key = normalizeSenderId(senderId);
  if (!key) return [];

  if (!isRedisBackend()) {
    const cutoff = now() - BUFFER_TTL_MS;
    const current = bufferedPayloadsBySender.get(key) ?? [];
    const next = current.filter((entry) => entry.timestamp >= cutoff);
    if (next.length > 0) {
      bufferedPayloadsBySender.set(key, next);
    } else {
      bufferedPayloadsBySender.delete(key);
    }
    return next.map((entry) => entry.payload);
  }

  const client = await getRedisClient();
  const redisKey = `${REDIS_BUFFER_KEY_PREFIX}${key}`;
  const cutoff = now() - BUFFER_TTL_MS;
  await client.zRemRangeByScore(redisKey, 0, cutoff - 1);
  const members = await client.zRangeByScore(redisKey, cutoff, "+inf");
  return members.map((member) => {
    try {
      return (JSON.parse(member) as { payload: unknown }).payload;
    } catch {
      return null;
    }
  });
}

async function bufferPayload(senderId: string, payload: unknown): Promise<void> {
  const key = normalizeSenderId(senderId);
  if (!key) return;

  if (!isRedisBackend()) {
    const current = bufferedPayloadsBySender.get(key) ?? [];
    const cutoff = now() - BUFFER_TTL_MS;
    const next = [...current.filter((entry) => entry.timestamp >= cutoff), { payload, timestamp: now() }].slice(
      -MAX_BUFFERED_PAYLOADS_PER_SENDER
    );
    bufferedPayloadsBySender.set(key, next);
    return;
  }

  const client = await getRedisClient();
  const redisKey = `${REDIS_BUFFER_KEY_PREFIX}${key}`;
  const timestamp = now();
  // A random nonce keeps sorted-set members unique even for two identical
  // payloads published within the same millisecond -- otherwise ZADD would
  // treat them as the same member and silently drop one.
  const member = JSON.stringify({ payload, timestamp, nonce: randomUUID() });
  await client.zAdd(redisKey, { score: timestamp, value: member });
  // Keep only the most recent MAX_BUFFERED_PAYLOADS_PER_SENDER entries.
  await client.zRemRangeByRank(redisKey, 0, -(MAX_BUFFERED_PAYLOADS_PER_SENDER + 1));
  await client.expire(redisKey, BUFFER_KEY_EXPIRE_SECONDS);
}

export async function addSubscriberForSender(senderId: string, subscriber: Subscriber): Promise<() => void> {
  const key = normalizeSenderId(senderId);
  let set = subscribersBySender.get(key);
  if (!set) {
    set = new Set();
    subscribersBySender.set(key, set);
  }
  set.add(subscriber);

  if (isRedisBackend()) {
    // Make sure the cross-instance subscription is live before replaying
    // buffered history, so a message published between now and the replay
    // finishing isn't missed.
    await ensureRedisReady();
  }

  const bufferedEntries = await pruneAndReadBufferedPayloads(key);
  for (const payload of bufferedEntries) {
    try {
      subscriber(payload);
    } catch (err) {
      console.error("SSE buffered replay error for sender", senderId, err);
    }
  }

  return () => {
    const current = subscribersBySender.get(key);
    if (!current) return;
    current.delete(subscriber);
    if (current.size === 0) {
      subscribersBySender.delete(key);
    }
  };
}

export async function publishToSender(senderId: string, payload: unknown): Promise<void> {
  const key = normalizeSenderId(senderId);
  await bufferPayload(key, payload);

  if (!isRedisBackend()) {
    dispatchToLocalSubscribers(key, payload);
    return;
  }

  // Delivery to local subscribers happens via the pub/sub handler below,
  // not directly here -- Redis delivers a publish back to this process's
  // own subscription too, so a direct call here would double-deliver.
  const client = await getRedisClient();
  await client.publish(`${REDIS_CHANNEL_PREFIX}${key}`, JSON.stringify(payload));
}

async function getCommittedCursor(senderId: string): Promise<number> {
  const key = normalizeSenderId(senderId);
  if (!key) return -1;

  if (!isRedisBackend()) {
    return committedCursorBySender.get(key) ?? -1;
  }

  const client = await getRedisClient();
  const raw = await client.get(`${REDIS_CURSOR_KEY_PREFIX}${key}`);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : -1;
}

// Best-effort: a read-then-write race between two processes could rarely
// let a lower value win. Acceptable here -- this cursor is a dedup/replay
// watermark for chat display, not a correctness-critical value, and losing
// the race costs at most one duplicate or delayed message.
async function setCommittedCursor(senderId: string, cursor: number): Promise<void> {
  const key = normalizeSenderId(senderId);
  if (!key) return;

  if (!isRedisBackend()) {
    committedCursorBySender.set(key, cursor);
    return;
  }

  const client = await getRedisClient();
  await client.set(`${REDIS_CURSOR_KEY_PREFIX}${key}`, String(cursor));
}

export async function setCommittedCursorFloor(senderId: string, cursor: number): Promise<void> {
  const key = normalizeSenderId(senderId);
  if (!key || !Number.isFinite(cursor)) return;
  const normalized = Math.trunc(cursor);
  const current = await getCommittedCursor(key);
  if (normalized > current) {
    await setCommittedCursor(key, normalized);
  }
}

export async function publishCommittedHistoryItems(
  senderId: string,
  items: RasaHistoryItem[],
  options?: {
    minEventIndexExclusive?: number;
    source?: string;
    traceId?: string | null;
  }
): Promise<number> {
  const key = normalizeSenderId(senderId);
  if (!key) return 0;

  const currentCursor = await getCommittedCursor(key);
  const floor = Math.max(
    currentCursor,
    typeof options?.minEventIndexExclusive === "number" && Number.isFinite(options.minEventIndexExclusive)
      ? Math.trunc(options.minEventIndexExclusive)
      : -1
  );

  let published = 0;
  let maxEventIndex = floor;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.role !== "user" && item.role !== "assistant") continue;

    const eventIndex =
      item.debug && typeof item.debug === "object" && typeof item.debug.eventIndex === "number"
        ? item.debug.eventIndex
        : null;

    if (eventIndex !== null && eventIndex <= floor) continue;

    const payload: Record<string, unknown> = { role: item.role };
    if (typeof item.text === "string" && item.text.length > 0) payload.text = item.text;
    if (typeof item.rawText === "string" && item.rawText.length > 0) payload.rawText = item.rawText;
    if (item.custom && typeof item.custom === "object") payload.custom = item.custom;
    if (Array.isArray(item.buttons) && item.buttons.length > 0) payload.buttons = item.buttons;
    if (typeof item.feedbackKey === "string") payload.feedbackKey = item.feedbackKey;

    const debugPayload: Record<string, unknown> =
      item.debug && typeof item.debug === "object" ? { ...item.debug } : {};
    if (options?.source && typeof debugPayload.source !== "string") debugPayload.source = options.source;
    if (options?.traceId) debugPayload.traceId = options.traceId;
    if (Object.keys(debugPayload).length > 0) payload.debug = debugPayload;

    if (payload.text === undefined && payload.custom === undefined) continue;

    await publishToSender(key, payload);
    published += 1;
    if (eventIndex !== null && eventIndex > maxEventIndex) maxEventIndex = eventIndex;
  }

  if (maxEventIndex > currentCursor) {
    await setCommittedCursor(key, maxEventIndex);
  }

  return published;
}
