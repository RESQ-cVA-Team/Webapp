import { createClient } from "redis";

type RedisKvClient = {
  isOpen: boolean;
  connect(): Promise<RedisKvClient>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  set(
    key: string,
    value: string,
    options?: { EX?: number; PX?: number; NX?: boolean; XX?: boolean }
  ): Promise<"OK" | null>;
};

type MemoryEntry = { value: string; expiresAt: number };

export type KvBackend = "memory" | "redis";

export type KvStoreOptions = {
  backend: KvBackend;
  redisUrl?: string;
  redisKeyPrefix: string;
  /** Distinct globalThis keys per store instance, so multiple KV stores
   * (e.g. the user token vault and the job store) don't share state or a
   * connection across Next.js hot-reloads/module re-evaluation. */
  globalMemoryMapKey: string;
  globalRedisClientKey: string;
};

export type KvStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
};

export function createKvStore(options: KvStoreOptions): KvStore {
  // Fail at boot, not on the first read/write that actually needs Redis.
  if (options.backend !== "memory" && options.backend !== "redis") {
    throw new Error(`Unsupported backend: ${options.backend} (${options.globalRedisClientKey})`);
  }
  if (options.backend === "redis" && !options.redisUrl) {
    throw new Error(`Redis URL must be set when backend=redis (${options.globalRedisClientKey})`);
  }

  const globalForKvStore = globalThis as unknown as Record<string, unknown>;
  let redisClientPromise: Promise<RedisKvClient> | null = null;

  function assertRedisUrl(): string {
    if (!options.redisUrl) {
      throw new Error(`Redis URL must be set when backend=redis (${options.globalRedisClientKey})`);
    }
    return options.redisUrl;
  }

  async function getRedisClient(): Promise<RedisKvClient> {
    const existing = globalForKvStore[options.globalRedisClientKey] as RedisKvClient | undefined;
    if (existing?.isOpen) return existing;

    if (!redisClientPromise) {
      const client = createClient({ url: assertRedisUrl() }) as RedisKvClient;
      redisClientPromise = client.connect().then(() => {
        globalForKvStore[options.globalRedisClientKey] = client;
        return client;
      });
    }
    return redisClientPromise;
  }

  function getMemoryMap(): Map<string, MemoryEntry> {
    let map = globalForKvStore[options.globalMemoryMapKey] as Map<string, MemoryEntry> | undefined;
    if (!map) {
      map = new Map();
      globalForKvStore[options.globalMemoryMapKey] = map;
    }
    return map;
  }

  function redisKey(key: string): string {
    return `${options.redisKeyPrefix}${key}`;
  }

  async function get(key: string): Promise<string | null> {
    if (options.backend === "redis") {
      const client = await getRedisClient();
      return client.get(redisKey(key));
    }

    const map = getMemoryMap();
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      map.delete(key);
      return null;
    }
    return entry.value;
  }

  async function set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (options.backend === "redis") {
      const client = await getRedisClient();
      await client.set(redisKey(key), value, { EX: Math.max(1, Math.ceil(ttlSeconds)) });
      return;
    }

    getMemoryMap().set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async function del(key: string): Promise<void> {
    if (options.backend === "redis") {
      const client = await getRedisClient();
      await client.del(redisKey(key));
      return;
    }

    getMemoryMap().delete(key);
  }

  return { get, set, del };
}
