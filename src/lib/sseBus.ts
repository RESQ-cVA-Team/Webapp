import type { RasaHistoryItem } from "@/lib/rasaHistory";

type Subscriber = (payload: unknown) => void;

type BufferedPayload = {
  payload: unknown;
  timestamp: number;
};

const globalForSseBus = globalThis as unknown as {
  sseSubscribersBySender?: Map<string, Set<Subscriber>>;
  sseBufferedPayloadsBySender?: Map<string, BufferedPayload[]>;
  sseCommittedCursorBySender?: Map<string, number>;
};

const subscribersBySender = globalForSseBus.sseSubscribersBySender ?? new Map<string, Set<Subscriber>>();
const bufferedPayloadsBySender =
  globalForSseBus.sseBufferedPayloadsBySender ?? new Map<string, BufferedPayload[]>();
const committedCursorBySender =
  globalForSseBus.sseCommittedCursorBySender ?? new Map<string, number>();

globalForSseBus.sseSubscribersBySender = subscribersBySender;
globalForSseBus.sseBufferedPayloadsBySender = bufferedPayloadsBySender;
globalForSseBus.sseCommittedCursorBySender = committedCursorBySender;
const MAX_BUFFERED_PAYLOADS_PER_SENDER = 20;
const BUFFER_TTL_MS = 15000;

function normalizeSenderId(senderId: string): string {
  return String(senderId ?? "").trim();
}

function now(): number {
  return Date.now();
}

function pruneBufferedPayloads(senderId: string): BufferedPayload[] {
  const key = normalizeSenderId(senderId);
  if (!key) return [];

  const cutoff = now() - BUFFER_TTL_MS;
  const current = bufferedPayloadsBySender.get(key) ?? [];
  const next = current.filter((entry) => entry.timestamp >= cutoff);

  if (next.length > 0) {
    bufferedPayloadsBySender.set(key, next);
  } else {
    bufferedPayloadsBySender.delete(key);
  }

  return next;
}

function bufferPayload(senderId: string, payload: unknown): void {
  const key = normalizeSenderId(senderId);
  if (!key) return;

  const next = [...pruneBufferedPayloads(key), { payload, timestamp: now() }].slice(
    -MAX_BUFFERED_PAYLOADS_PER_SENDER
  );

  bufferedPayloadsBySender.set(key, next);
}

export function addSubscriberForSender(senderId: string, subscriber: Subscriber): () => void {
  const key = normalizeSenderId(senderId);
  let set = subscribersBySender.get(key);
  if (!set) {
    set = new Set();
    subscribersBySender.set(key, set);
  }
  set.add(subscriber);

  const bufferedEntries = pruneBufferedPayloads(key);

  for (const entry of bufferedEntries) {
    try {
      subscriber(entry.payload);
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

export function publishToSender(senderId: string, payload: unknown): void {
  const key = normalizeSenderId(senderId);
  bufferPayload(key, payload);
  const set = subscribersBySender.get(key);
  if (!set) return;
  for (const subscriber of set) {
    try {
      subscriber(payload);
    } catch (err) {
      console.error("SSE subscriber error for sender", senderId, err);
    }
  }
}

function getCommittedCursor(senderId: string): number {
  const key = normalizeSenderId(senderId);
  if (!key) return -1;
  return committedCursorBySender.get(key) ?? -1;
}

export function setCommittedCursorFloor(senderId: string, cursor: number): void {
  const key = normalizeSenderId(senderId);
  if (!key || !Number.isFinite(cursor)) return;
  const normalized = Math.trunc(cursor);
  if (normalized > getCommittedCursor(key)) {
    committedCursorBySender.set(key, normalized);
  }
}

export function publishCommittedHistoryItems(
  senderId: string,
  items: RasaHistoryItem[],
  options?: {
    minEventIndexExclusive?: number;
    source?: string;
    traceId?: string | null;
  }
): number {
  const key = normalizeSenderId(senderId);
  if (!key) return 0;

  const floor = Math.max(
    getCommittedCursor(key),
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

    publishToSender(key, payload);
    published += 1;
    if (eventIndex !== null && eventIndex > maxEventIndex) maxEventIndex = eventIndex;
  }

  if (maxEventIndex > getCommittedCursor(key)) {
    committedCursorBySender.set(key, maxEventIndex);
  }

  return published;
}
