import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { Pool } from "pg";
import type { RasaHistoryItem } from "@/lib/rasaHistory";
import type { CollectedServiceSnapshot } from "@/lib/serviceVersionCollector";
import type { InteractionLogIdentityMode } from "@/lib/interactionLogSettingsStore";

export type InteractionLogEntry = {
  id: string;
  identityMode: InteractionLogIdentityMode;
  userSub: string | null;
  userEmail: string | null;
  userName: string | null;
  userPseudonym: string | null;
  threadId: number | null;
  senderId: string;
  capturedAt: string;
  source: "sync" | "long-task-callback";
  traceId: string | null;
  history: RasaHistoryItem[];
  serviceSnapshots: CollectedServiceSnapshot[];
  expiresAt: string;
};

type CreateInteractionLogEntryInput = {
  identityMode: InteractionLogIdentityMode;
  userSub: string | null;
  userEmail: string | null;
  userName: string | null;
  userPseudonym: string | null;
  threadId: number | null;
  senderId: string;
  source: "sync" | "long-task-callback";
  traceId: string | null;
  history: RasaHistoryItem[];
  serviceSnapshots: CollectedServiceSnapshot[];
  retentionDays: number;
};

type ListFilters = {
  userEmail?: string | null;
  source?: "sync" | "long-task-callback" | null;
  limit?: number;
};

type StorageInfo = {
  kind: "local-file" | "postgres";
  description: string;
  warning: string | null;
};

type LocalStore = {
  entries: InteractionLogEntry[];
};

type PostgresEntryRow = {
  id: string;
  identity_mode: InteractionLogIdentityMode;
  user_sub: string | null;
  user_email: string | null;
  user_name: string | null;
  user_pseudonym: string | null;
  thread_id: number | null;
  sender_id: string;
  captured_at: Date | string;
  source: "sync" | "long-task-callback";
  trace_id: string | null;
  history_json: unknown;
  service_snapshots_json: unknown;
  expires_at: Date | string;
};

const globalForInteractionLogStore = globalThis as unknown as {
  interactionLogLocalWriteQueue?: Promise<unknown>;
  interactionLogPostgresPool?: Pool;
  interactionLogSchemaPromise?: Promise<void>;
  interactionLogLocalWarningShown?: boolean;
};

let localWriteQueue = globalForInteractionLogStore.interactionLogLocalWriteQueue ?? Promise.resolve();

function isTruthy(value: string | undefined | null): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getLocalStorePath(): string {
  const configured = process.env.INTERACTION_LOG_LOCAL_ENTRIES_PATH?.trim();
  if (configured) {
    return configured;
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "interaction-log-entries.json");
}

function getConfiguredPostgresUrl(): string | null {
  const directUrl = process.env.INTERACTION_LOG_DATABASE_URL?.trim();
  if (directUrl && /^postgres(ql)?:\/\//i.test(directUrl)) {
    return directUrl;
  }

  const host = process.env.INTERACTION_LOG_DB_HOST?.trim();
  const database = process.env.INTERACTION_LOG_DB_NAME?.trim();
  const user = process.env.INTERACTION_LOG_DB_USER?.trim();
  const password = process.env.INTERACTION_LOG_DB_PASSWORD?.trim();
  const port = process.env.INTERACTION_LOG_DB_PORT?.trim() || "5432";
  const hasDiscreteConfig = [
    process.env.INTERACTION_LOG_DB_HOST,
    process.env.INTERACTION_LOG_DB_NAME,
    process.env.INTERACTION_LOG_DB_USER,
    process.env.INTERACTION_LOG_DB_PASSWORD,
    process.env.INTERACTION_LOG_DB_PORT,
    process.env.INTERACTION_LOG_DB_SSL,
  ].some((value) => typeof value === "string" && value.trim().length > 0);

  if (!hasDiscreteConfig) {
    return null;
  }

  if (!host || !database || !user || !password) {
    throw new Error(
      "INTERACTION_LOG_DB_HOST, INTERACTION_LOG_DB_NAME, INTERACTION_LOG_DB_USER, and INTERACTION_LOG_DB_PASSWORD are required when using INTERACTION_LOG_DB_* configuration"
    );
  }

  const url = new URL(`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`);
  if (isTruthy(process.env.INTERACTION_LOG_DB_SSL)) {
    url.searchParams.set("sslmode", "require");
  }

  return url.toString();
}

// Fail at boot on a partial INTERACTION_LOG_DB_* config, not on the first
// read/write that actually needs the connection -- fully absent config is
// fine (falls back to local-file storage), only a partial one is an error.
getConfiguredPostgresUrl();

function getSanitizedPostgresUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "******";
    }
    return parsed.toString();
  } catch {
    return "postgresql://<configured>";
  }
}

export function getInteractionLogEntryStorageInfo(): StorageInfo {
  const postgresUrl = getConfiguredPostgresUrl();

  if (postgresUrl) {
    return {
      kind: "postgres",
      description: getSanitizedPostgresUrl(postgresUrl),
      warning: null,
    };
  }

  const localPath = getLocalStorePath();
  return {
    kind: "local-file",
    description: localPath,
    warning: `Interaction log entry storage is using the local file fallback at ${localPath}. This is fine for testing, but configure INTERACTION_LOG_DATABASE_URL or INTERACTION_LOG_DB_* for a shared/production environment.`,
  };
}

function warnIfUsingLocalFallback() {
  const info = getInteractionLogEntryStorageInfo();
  if (info.kind !== "local-file" || globalForInteractionLogStore.interactionLogLocalWarningShown) {
    return;
  }

  console.warn(info.warning);
  globalForInteractionLogStore.interactionLogLocalWarningShown = true;
}

function withLocalWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const pendingTask = localWriteQueue.then(task, task);
  localWriteQueue = pendingTask.then(
    () => undefined,
    () => undefined
  );
  globalForInteractionLogStore.interactionLogLocalWriteQueue = localWriteQueue;
  return pendingTask;
}

async function ensureLocalStoreFile(): Promise<void> {
  const storePath = getLocalStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });

  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, JSON.stringify({ entries: [] } satisfies LocalStore, null, 2), "utf-8");
  }
}

async function readLocalStore(): Promise<LocalStore> {
  await ensureLocalStoreFile();

  try {
    const raw = await fs.readFile(getLocalStorePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<LocalStore>;
    return { entries: Array.isArray(parsed.entries) ? (parsed.entries as InteractionLogEntry[]) : [] };
  } catch {
    return { entries: [] };
  }
}

async function writeLocalStore(data: LocalStore): Promise<void> {
  await ensureLocalStoreFile();
  await fs.writeFile(getLocalStorePath(), JSON.stringify(data, null, 2), "utf-8");
}

function isExpired(entry: InteractionLogEntry, now: number): boolean {
  const expiresAt = new Date(entry.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

async function purgeExpiredLocal(): Promise<void> {
  warnIfUsingLocalFallback();
  await withLocalWriteLock(async () => {
    const store = await readLocalStore();
    const now = Date.now();
    const kept = store.entries.filter((entry) => !isExpired(entry, now));
    if (kept.length !== store.entries.length) {
      await writeLocalStore({ entries: kept });
    }
  });
}

/** One row per conversation (keyed by senderId, the same conversation
 * identity the SSE bus and Rasa tracker already use), upserted on every
 * turn -- not one row per turn. Each call already carries the full
 * cumulative history for that sender (see interactionLogCapture.ts), so
 * inserting a fresh row per turn would duplicate the entire prior
 * conversation into every new row. Updating in place keeps exactly one,
 * always-current copy per conversation. expiresAt is recomputed from
 * "now" on every update (a sliding window from last activity), so an
 * actively-used conversation never expires mid-use. */
async function upsertLocalEntry(input: CreateInteractionLogEntryInput): Promise<InteractionLogEntry> {
  warnIfUsingLocalFallback();
  await purgeExpiredLocal();

  return withLocalWriteLock(async () => {
    const store = await readLocalStore();
    const capturedAt = new Date();
    const expiresAt = new Date(capturedAt.getTime() + input.retentionDays * 24 * 60 * 60 * 1000);

    const existing = store.entries.find((entry) => entry.senderId === input.senderId);

    const entry: InteractionLogEntry = {
      id: existing?.id ?? randomUUID(),
      identityMode: input.identityMode,
      userSub: input.userSub,
      userEmail: input.userEmail,
      userName: input.userName,
      userPseudonym: input.userPseudonym,
      threadId: input.threadId,
      senderId: input.senderId,
      capturedAt: capturedAt.toISOString(),
      source: input.source,
      traceId: input.traceId,
      history: input.history,
      serviceSnapshots: input.serviceSnapshots,
      expiresAt: expiresAt.toISOString(),
    };

    if (existing) {
      Object.assign(existing, entry);
    } else {
      store.entries.push(entry);
    }
    await writeLocalStore(store);
    return entry;
  });
}

async function listLocalEntries(filters: ListFilters): Promise<{ total: number; results: InteractionLogEntry[] }> {
  warnIfUsingLocalFallback();
  await purgeExpiredLocal();

  const take = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const store = await readLocalStore();
  const filtered = store.entries
    .filter((entry) => (filters.userEmail ? entry.userEmail === filters.userEmail.toLowerCase() : true))
    .filter((entry) => (filters.source ? entry.source === filters.source : true))
    .sort((left, right) => new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime());

  return { total: filtered.length, results: filtered.slice(0, take) };
}

async function getLocalEntryById(id: string): Promise<InteractionLogEntry | null> {
  warnIfUsingLocalFallback();
  const store = await readLocalStore();
  return store.entries.find((entry) => entry.id === id) ?? null;
}

function getPostgresPool(): Pool {
  const existingPool = globalForInteractionLogStore.interactionLogPostgresPool;
  if (existingPool) {
    return existingPool;
  }

  const connectionString = getConfiguredPostgresUrl();
  if (!connectionString) {
    throw new Error("Missing INTERACTION_LOG_DATABASE_URL or INTERACTION_LOG_DB_* configuration");
  }

  const pool = new Pool({
    connectionString,
    ssl: isTruthy(process.env.INTERACTION_LOG_DB_SSL) ? { rejectUnauthorized: false } : undefined,
  });

  globalForInteractionLogStore.interactionLogPostgresPool = pool;
  return pool;
}

async function ensurePostgresSchema() {
  if (globalForInteractionLogStore.interactionLogSchemaPromise) {
    return globalForInteractionLogStore.interactionLogSchemaPromise;
  }

  const pool = getPostgresPool();
  globalForInteractionLogStore.interactionLogSchemaPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS interaction_log_entry (
          id TEXT PRIMARY KEY,
          identity_mode TEXT NOT NULL,
          user_sub TEXT,
          user_email TEXT,
          user_name TEXT,
          user_pseudonym TEXT,
          thread_id INTEGER,
          sender_id TEXT NOT NULL UNIQUE,
          captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          source TEXT NOT NULL,
          trace_id TEXT,
          history_json JSONB NOT NULL,
          service_snapshots_json JSONB,
          expires_at TIMESTAMPTZ NOT NULL
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS idx_interaction_log_expires_at ON interaction_log_entry(expires_at)");
      await client.query("CREATE INDEX IF NOT EXISTS idx_interaction_log_captured_at ON interaction_log_entry(captured_at DESC)");
      await client.query("CREATE INDEX IF NOT EXISTS idx_interaction_log_user_email ON interaction_log_entry(user_email)");
    } finally {
      client.release();
    }
  })();

  return globalForInteractionLogStore.interactionLogSchemaPromise;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function hydratePostgresRow(row: PostgresEntryRow): InteractionLogEntry {
  return {
    id: row.id,
    identityMode: row.identity_mode,
    userSub: row.user_sub,
    userEmail: row.user_email,
    userName: row.user_name,
    userPseudonym: row.user_pseudonym,
    threadId: row.thread_id,
    senderId: row.sender_id,
    capturedAt: toIsoString(row.captured_at),
    source: row.source,
    traceId: row.trace_id,
    history: Array.isArray(row.history_json) ? (row.history_json as RasaHistoryItem[]) : [],
    serviceSnapshots: Array.isArray(row.service_snapshots_json) ? (row.service_snapshots_json as CollectedServiceSnapshot[]) : [],
    expiresAt: toIsoString(row.expires_at),
  };
}

async function purgeExpiredPostgres(): Promise<void> {
  const pool = getPostgresPool();
  await ensurePostgresSchema();
  await pool.query("DELETE FROM interaction_log_entry WHERE expires_at <= NOW()");
}

/** Upserted by sender_id -- see upsertLocalEntry's comment for why (one row
 * per conversation, not one per turn). */
async function upsertPostgresEntry(input: CreateInteractionLogEntryInput): Promise<InteractionLogEntry> {
  const pool = getPostgresPool();
  await ensurePostgresSchema();
  await purgeExpiredPostgres();

  const id = randomUUID();
  const result = await pool.query<PostgresEntryRow>(
    `INSERT INTO interaction_log_entry (
      id, identity_mode, user_sub, user_email, user_name, user_pseudonym,
      thread_id, sender_id, source, trace_id, history_json,
      service_snapshots_json, expires_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11::jsonb,
      $12::jsonb, NOW() + ($13 || ' days')::interval
    )
    ON CONFLICT (sender_id) DO UPDATE SET
      identity_mode = EXCLUDED.identity_mode,
      user_sub = EXCLUDED.user_sub,
      user_email = EXCLUDED.user_email,
      user_name = EXCLUDED.user_name,
      user_pseudonym = EXCLUDED.user_pseudonym,
      thread_id = EXCLUDED.thread_id,
      captured_at = NOW(),
      source = EXCLUDED.source,
      trace_id = EXCLUDED.trace_id,
      history_json = EXCLUDED.history_json,
      service_snapshots_json = EXCLUDED.service_snapshots_json,
      expires_at = EXCLUDED.expires_at
    RETURNING *`,
    [
      id,
      input.identityMode,
      input.userSub,
      input.userEmail,
      input.userName,
      input.userPseudonym,
      input.threadId,
      input.senderId,
      input.source,
      input.traceId,
      JSON.stringify(input.history),
      JSON.stringify(input.serviceSnapshots),
      input.retentionDays,
    ]
  );

  return hydratePostgresRow(result.rows[0]);
}

async function listPostgresEntries(filters: ListFilters): Promise<{ total: number; results: InteractionLogEntry[] }> {
  const pool = getPostgresPool();
  await ensurePostgresSchema();
  await purgeExpiredPostgres();

  const take = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.userEmail) {
    params.push(filters.userEmail.toLowerCase());
    clauses.push(`user_email = $${params.length}`);
  }
  if (filters.source) {
    params.push(filters.source);
    clauses.push(`source = $${params.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const countResult = await pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM interaction_log_entry ${whereClause}`, params);
  const rowsResult = await pool.query<PostgresEntryRow>(
    `SELECT * FROM interaction_log_entry ${whereClause} ORDER BY captured_at DESC LIMIT $${params.length + 1}`,
    [...params, take]
  );

  return {
    total: Number(countResult.rows[0]?.total ?? 0),
    results: rowsResult.rows.map(hydratePostgresRow),
  };
}

async function getPostgresEntryById(id: string): Promise<InteractionLogEntry | null> {
  const pool = getPostgresPool();
  await ensurePostgresSchema();

  const result = await pool.query<PostgresEntryRow>("SELECT * FROM interaction_log_entry WHERE id = $1 LIMIT 1", [id]);
  return result.rows[0] ? hydratePostgresRow(result.rows[0]) : null;
}

export async function upsertInteractionLogEntry(input: CreateInteractionLogEntryInput): Promise<InteractionLogEntry> {
  if (getInteractionLogEntryStorageInfo().kind === "postgres") {
    return upsertPostgresEntry(input);
  }
  return upsertLocalEntry(input);
}

export async function listInteractionLogEntries(filters: ListFilters): Promise<{ total: number; results: InteractionLogEntry[] }> {
  if (getInteractionLogEntryStorageInfo().kind === "postgres") {
    return listPostgresEntries(filters);
  }
  return listLocalEntries(filters);
}

export async function getInteractionLogEntryById(id: string): Promise<InteractionLogEntry | null> {
  if (getInteractionLogEntryStorageInfo().kind === "postgres") {
    return getPostgresEntryById(id);
  }
  return getLocalEntryById(id);
}
