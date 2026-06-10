export type SseBusEvent = {
  id: string;
  payload: unknown;
};

type Subscriber = (event: SseBusEvent) => void;

type BufferedPayload = {
  id: string;
  payload: unknown;
  timestamp: number;
};

const globalForSseBus = globalThis as unknown as {
  sseSubscribersBySender?: Map<string, Set<Subscriber>>;
  sseBufferedPayloadsBySender?: Map<string, BufferedPayload[]>;
};

const subscribersBySender = globalForSseBus.sseSubscribersBySender ?? new Map<string, Set<Subscriber>>();
const bufferedPayloadsBySender =
  globalForSseBus.sseBufferedPayloadsBySender ?? new Map<string, BufferedPayload[]>();

globalForSseBus.sseSubscribersBySender = subscribersBySender;
globalForSseBus.sseBufferedPayloadsBySender = bufferedPayloadsBySender;
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

  const next = [...pruneBufferedPayloads(key), { id: crypto.randomUUID(), payload, timestamp: now() }].slice(
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
      subscriber({ id: entry.id, payload: entry.payload });
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
  const bufferedEntries = bufferedPayloadsBySender.get(key);
  const latestEntry = bufferedEntries?.[bufferedEntries.length - 1];
  if (!latestEntry) return;
  const set = subscribersBySender.get(key);
  if (!set) return;
  for (const subscriber of set) {
    try {
      subscriber({ id: latestEntry.id, payload: latestEntry.payload });
    } catch (err) {
      console.error("SSE subscriber error for sender", senderId, err);
    }
  }
}
