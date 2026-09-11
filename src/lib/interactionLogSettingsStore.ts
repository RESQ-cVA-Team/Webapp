import { promises as fs } from "fs";
import path from "path";
import { Pool } from "pg";
import { getInteractionLogAllowlistCap, getInteractionLogRetentionCapDays } from "@/lib/interactionLogConfig";

export type InteractionLogMode = "everyone" | "allowlist" | "denylist" | "percentage";
export type InteractionLogIdentityMode = "identified" | "pseudonymous";

export type InteractionLogSettings = {
  masterEnabled: boolean;
  mode: InteractionLogMode;
  allowlistEmails: string[];
  denylistEmails: string[];
  samplePercentage: number;
  retentionDays: number;
  disclosureEnabled: boolean;
  storageIdentityMode: InteractionLogIdentityMode;
  updatedAt: string;
  updatedByEmail: string | null;
};

const DEFAULT_SETTINGS: InteractionLogSettings = {
  masterEnabled: false,
  mode: "allowlist",
  allowlistEmails: [],
  denylistEmails: [],
  samplePercentage: 0,
  retentionDays: 30,
  disclosureEnabled: true,
  storageIdentityMode: "identified",
  updatedAt: new Date(0).toISOString(),
  updatedByEmail: null,
};

type InteractionLogSettingsInput = Partial<Omit<InteractionLogSettings, "updatedAt">> & {
  updatedByEmail?: string | null;
};

type StorageInfo = {
  kind: "local-file" | "postgres";
  description: string;
  warning: string | null;
};

type LocalStore = {
  settings: InteractionLogSettings;
};

type PostgresSettingsRow = {
  master_enabled: boolean;
  mode: InteractionLogMode;
  allowlist_emails: unknown;
  denylist_emails: unknown;
  sample_percentage: number;
  retention_days: number;
  disclosure_enabled: boolean;
  storage_identity_mode: InteractionLogIdentityMode;
  updated_at: Date | string;
  updated_by_email: string | null;
};

const globalForInteractionLogSettings = globalThis as unknown as {
  interactionLogSettingsLocalWriteQueue?: Promise<unknown>;
  interactionLogSettingsPostgresPool?: Pool;
  interactionLogSettingsSchemaPromise?: Promise<void>;
  interactionLogSettingsLocalWarningShown?: boolean;
};

let localWriteQueue = globalForInteractionLogSettings.interactionLogSettingsLocalWriteQueue ?? Promise.resolve();

function isTruthy(value: string | undefined | null): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getLocalStorePath(): string {
  const configured = process.env.INTERACTION_LOG_LOCAL_STORE_PATH?.trim();
  if (configured) {
    return configured;
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "interaction-log-settings.json");
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

export function getInteractionLogStorageInfo(): StorageInfo {
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
    warning: `Interaction log storage is using the local file fallback at ${localPath}. This is fine for testing, but configure INTERACTION_LOG_DATABASE_URL or INTERACTION_LOG_DB_* for a shared/production environment.`,
  };
}

function warnIfUsingLocalFallback() {
  const info = getInteractionLogStorageInfo();
  if (info.kind !== "local-file" || globalForInteractionLogSettings.interactionLogSettingsLocalWarningShown) {
    return;
  }

  console.warn(info.warning);
  globalForInteractionLogSettings.interactionLogSettingsLocalWarningShown = true;
}

function withLocalWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const pendingTask = localWriteQueue.then(task, task);
  localWriteQueue = pendingTask.then(
    () => undefined,
    () => undefined
  );
  globalForInteractionLogSettings.interactionLogSettingsLocalWriteQueue = localWriteQueue;
  return pendingTask;
}

async function ensureLocalStoreFile(): Promise<void> {
  const storePath = getLocalStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });

  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, JSON.stringify({ settings: DEFAULT_SETTINGS } satisfies LocalStore, null, 2), "utf-8");
  }
}

async function readLocalStore(): Promise<LocalStore> {
  await ensureLocalStoreFile();

  try {
    const raw = await fs.readFile(getLocalStorePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<LocalStore>;
    return {
      settings: parsed.settings ? { ...DEFAULT_SETTINGS, ...parsed.settings } : DEFAULT_SETTINGS,
    };
  } catch {
    return { settings: DEFAULT_SETTINGS };
  }
}

async function writeLocalStore(data: LocalStore): Promise<void> {
  await ensureLocalStoreFile();
  await fs.writeFile(getLocalStorePath(), JSON.stringify(data, null, 2), "utf-8");
}

function clampSettings(input: InteractionLogSettingsInput, previous: InteractionLogSettings): InteractionLogSettings {
  const retentionCap = getInteractionLogRetentionCapDays();
  const allowlistCap = getInteractionLogAllowlistCap();

  const normalizeEmails = (value: string[] | undefined, fallback: string[]) =>
    value === undefined
      ? fallback
      : [...new Set(value.map((email) => email.trim().toLowerCase()).filter(Boolean))].slice(0, allowlistCap);

  return {
    masterEnabled: input.masterEnabled ?? previous.masterEnabled,
    mode: input.mode && ["everyone", "allowlist", "denylist", "percentage"].includes(input.mode) ? input.mode : previous.mode,
    allowlistEmails: normalizeEmails(input.allowlistEmails, previous.allowlistEmails),
    denylistEmails: normalizeEmails(input.denylistEmails, previous.denylistEmails),
    samplePercentage:
      input.samplePercentage === undefined
        ? previous.samplePercentage
        : Math.min(100, Math.max(0, Math.trunc(input.samplePercentage))),
    retentionDays:
      input.retentionDays === undefined
        ? previous.retentionDays
        : Math.min(retentionCap, Math.max(1, Math.trunc(input.retentionDays))),
    disclosureEnabled: input.disclosureEnabled ?? previous.disclosureEnabled,
    storageIdentityMode:
      input.storageIdentityMode && ["identified", "pseudonymous"].includes(input.storageIdentityMode)
        ? input.storageIdentityMode
        : previous.storageIdentityMode,
    updatedAt: new Date().toISOString(),
    updatedByEmail: input.updatedByEmail ?? previous.updatedByEmail ?? null,
  };
}

async function readLocalSettings(): Promise<InteractionLogSettings> {
  warnIfUsingLocalFallback();
  const store = await readLocalStore();
  return store.settings;
}

async function writeLocalSettings(input: InteractionLogSettingsInput): Promise<InteractionLogSettings> {
  warnIfUsingLocalFallback();
  return withLocalWriteLock(async () => {
    const store = await readLocalStore();
    const next = clampSettings(input, store.settings);
    await writeLocalStore({ settings: next });
    return next;
  });
}

function getPostgresPool(): Pool {
  const existingPool = globalForInteractionLogSettings.interactionLogSettingsPostgresPool;
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

  globalForInteractionLogSettings.interactionLogSettingsPostgresPool = pool;
  return pool;
}

async function ensurePostgresSchema() {
  if (globalForInteractionLogSettings.interactionLogSettingsSchemaPromise) {
    return globalForInteractionLogSettings.interactionLogSettingsSchemaPromise;
  }

  const pool = getPostgresPool();
  globalForInteractionLogSettings.interactionLogSettingsSchemaPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS interaction_log_settings (
          id TEXT PRIMARY KEY,
          master_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          mode TEXT NOT NULL DEFAULT 'allowlist',
          allowlist_emails JSONB NOT NULL DEFAULT '[]',
          denylist_emails JSONB NOT NULL DEFAULT '[]',
          sample_percentage INTEGER NOT NULL DEFAULT 0,
          retention_days INTEGER NOT NULL DEFAULT 30,
          disclosure_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          storage_identity_mode TEXT NOT NULL DEFAULT 'identified',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by_email TEXT
        )
      `);
    } finally {
      client.release();
    }
  })();

  return globalForInteractionLogSettings.interactionLogSettingsSchemaPromise;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function hydratePostgresRow(row: PostgresSettingsRow): InteractionLogSettings {
  return {
    masterEnabled: row.master_enabled,
    mode: row.mode,
    allowlistEmails: Array.isArray(row.allowlist_emails) ? (row.allowlist_emails as string[]) : [],
    denylistEmails: Array.isArray(row.denylist_emails) ? (row.denylist_emails as string[]) : [],
    samplePercentage: row.sample_percentage,
    retentionDays: row.retention_days,
    disclosureEnabled: row.disclosure_enabled,
    storageIdentityMode: row.storage_identity_mode,
    updatedAt: toIsoString(row.updated_at),
    updatedByEmail: row.updated_by_email,
  };
}

async function readPostgresSettings(): Promise<InteractionLogSettings> {
  const pool = getPostgresPool();
  await ensurePostgresSchema();

  const existing = await pool.query<PostgresSettingsRow>("SELECT * FROM interaction_log_settings WHERE id = 'singleton'");
  if (existing.rows[0]) {
    return hydratePostgresRow(existing.rows[0]);
  }

  const inserted = await pool.query<PostgresSettingsRow>(
    `INSERT INTO interaction_log_settings (id, master_enabled, mode, allowlist_emails, denylist_emails, sample_percentage, retention_days, disclosure_enabled, storage_identity_mode)
     VALUES ('singleton', $1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [
      DEFAULT_SETTINGS.masterEnabled,
      DEFAULT_SETTINGS.mode,
      JSON.stringify(DEFAULT_SETTINGS.allowlistEmails),
      JSON.stringify(DEFAULT_SETTINGS.denylistEmails),
      DEFAULT_SETTINGS.samplePercentage,
      DEFAULT_SETTINGS.retentionDays,
      DEFAULT_SETTINGS.disclosureEnabled,
      DEFAULT_SETTINGS.storageIdentityMode,
    ]
  );

  if (inserted.rows[0]) {
    return hydratePostgresRow(inserted.rows[0]);
  }

  // A concurrent request won the insert race -- read what it wrote.
  const raced = await pool.query<PostgresSettingsRow>("SELECT * FROM interaction_log_settings WHERE id = 'singleton'");
  return raced.rows[0] ? hydratePostgresRow(raced.rows[0]) : DEFAULT_SETTINGS;
}

async function writePostgresSettings(input: InteractionLogSettingsInput): Promise<InteractionLogSettings> {
  const pool = getPostgresPool();
  await ensurePostgresSchema();

  const previous = await readPostgresSettings();
  const next = clampSettings(input, previous);

  const result = await pool.query<PostgresSettingsRow>(
    `INSERT INTO interaction_log_settings (id, master_enabled, mode, allowlist_emails, denylist_emails, sample_percentage, retention_days, disclosure_enabled, storage_identity_mode, updated_at, updated_by_email)
     VALUES ('singleton', $1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, NOW(), $9)
     ON CONFLICT (id) DO UPDATE SET
       master_enabled = EXCLUDED.master_enabled,
       mode = EXCLUDED.mode,
       allowlist_emails = EXCLUDED.allowlist_emails,
       denylist_emails = EXCLUDED.denylist_emails,
       sample_percentage = EXCLUDED.sample_percentage,
       retention_days = EXCLUDED.retention_days,
       disclosure_enabled = EXCLUDED.disclosure_enabled,
       storage_identity_mode = EXCLUDED.storage_identity_mode,
       updated_at = NOW(),
       updated_by_email = EXCLUDED.updated_by_email
     RETURNING *`,
    [
      next.masterEnabled,
      next.mode,
      JSON.stringify(next.allowlistEmails),
      JSON.stringify(next.denylistEmails),
      next.samplePercentage,
      next.retentionDays,
      next.disclosureEnabled,
      next.storageIdentityMode,
      next.updatedByEmail,
    ]
  );

  return hydratePostgresRow(result.rows[0]);
}

export async function readInteractionLogSettings(): Promise<InteractionLogSettings> {
  if (getInteractionLogStorageInfo().kind === "postgres") {
    return readPostgresSettings();
  }
  return readLocalSettings();
}

export async function writeInteractionLogSettings(input: InteractionLogSettingsInput): Promise<InteractionLogSettings> {
  if (getInteractionLogStorageInfo().kind === "postgres") {
    return writePostgresSettings(input);
  }
  return writeLocalSettings(input);
}
