import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { Pool } from "pg";
import type { FeedbackRatingValue } from "@/lib/feedbackConfig";

export type FeedbackServiceSnapshot = {
  service: string;
  version?: string | null;
  commitSha?: string | null;
  imageTag?: string | null;
  modelName?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type StoredFeedbackRecord = {
  id: string;
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  threadId: number;
  threadName?: string | null;
  messageKey: string;
  messageText: string;
  rating: FeedbackRatingValue;
  issues: string[];
  detailText?: string | null;
  includeConversationContext: boolean;
  conversationContext?: unknown;
  submissionContext?: unknown;
  serviceSnapshots: FeedbackServiceSnapshot[];
  createdAt: string;
  updatedAt: string;
};

type CreateFeedbackInput = {
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  userAliases?: string[];
  threadId: number;
  threadName?: string | null;
  messageKey: string;
  messageText: string;
  rating: FeedbackRatingValue;
  issues: string[];
  detailText?: string | null;
  includeConversationContext: boolean;
  conversationContext?: unknown;
  submissionContext?: unknown;
  serviceSnapshots?: FeedbackServiceSnapshot[];
};

type AdminFeedbackListFilters = {
  rating?: FeedbackRatingValue;
  issueTag?: string | null;
  query?: string | null;
  limit?: number;
};

type FeedbackStorageInfo = {
  kind: "local-file" | "postgres";
  description: string;
  warning: string | null;
};

type LocalFeedbackStore = {
  records: StoredFeedbackRecord[];
};

type PostgresFeedbackRow = {
  id: string;
  user_id: string;
  user_email: string | null;
  user_name: string | null;
  thread_id: number;
  thread_name: string | null;
  message_key: string;
  message_text: string;
  rating: FeedbackRatingValue;
  detail_text: string | null;
  include_conversation_context: boolean;
  conversation_context_json: unknown;
  submission_context_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

type PostgresIssueRow = {
  feedback_id: string;
  tag: string;
};

type PostgresSnapshotRow = {
  feedback_id: string;
  service: string;
  version: string | null;
  commit_sha: string | null;
  image_tag: string | null;
  model_name: string | null;
  metadata_json: unknown;
};

const globalForFeedbackStore = globalThis as unknown as {
  feedbackLocalWriteQueue?: Promise<unknown>;
  feedbackPostgresPool?: Pool;
  feedbackPostgresSchemaPromise?: Promise<void>;
  feedbackLocalWarningShown?: boolean;
};

let localWriteQueue = globalForFeedbackStore.feedbackLocalWriteQueue ?? Promise.resolve();

function isTruthy(value: string | undefined | null): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getLocalFeedbackStorePath(): string {
  const configured = process.env.FEEDBACK_LOCAL_STORE_PATH?.trim();
  if (configured) {
    return configured;
  }

  return path.join(process.cwd(), ".data", "feedback-store.json");
}

function getConfiguredPostgresUrl(): string | null {
  const directUrl = process.env.FEEDBACK_DATABASE_URL?.trim();
  if (directUrl && /^postgres(ql)?:\/\//i.test(directUrl)) {
    return directUrl;
  }

  const host = process.env.FEEDBACK_DB_HOST?.trim();
  const database = process.env.FEEDBACK_DB_NAME?.trim();
  const user = process.env.FEEDBACK_DB_USER?.trim();
  const password = process.env.FEEDBACK_DB_PASSWORD ?? "";
  const port = process.env.FEEDBACK_DB_PORT?.trim() || "5432";

  if (!host || !database || !user) {
    return null;
  }

  const url = new URL(`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`);
  if (isTruthy(process.env.FEEDBACK_DB_SSL)) {
    url.searchParams.set("sslmode", "require");
  }

  return url.toString();
}

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

export function getFeedbackStorageInfo(): FeedbackStorageInfo {
  const postgresUrl = getConfiguredPostgresUrl();

  if (postgresUrl) {
    return {
      kind: "postgres",
      description: getSanitizedPostgresUrl(postgresUrl),
      warning: null,
    };
  }

  const localPath = getLocalFeedbackStorePath();
  return {
    kind: "local-file",
    description: localPath,
    warning: `Feedback storage is using the local file fallback at ${localPath}. This is fine for testing, but configure FEEDBACK_DATABASE_URL or FEEDBACK_DB_* for production or shared environments.`,
  };
}

function warnIfUsingLocalFallback() {
  const info = getFeedbackStorageInfo();
  if (info.kind !== "local-file" || globalForFeedbackStore.feedbackLocalWarningShown) {
    return;
  }

  console.warn(info.warning);
  globalForFeedbackStore.feedbackLocalWarningShown = true;
}

function withLocalWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const pendingTask = localWriteQueue.then(task, task);
  localWriteQueue = pendingTask.then(
    () => undefined,
    () => undefined
  );
  globalForFeedbackStore.feedbackLocalWriteQueue = localWriteQueue;
  return pendingTask;
}

async function ensureLocalStoreFile(): Promise<void> {
  const storePath = getLocalFeedbackStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });

  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, JSON.stringify({ records: [] satisfies StoredFeedbackRecord[] }, null, 2), "utf-8");
  }
}

async function readLocalStore(): Promise<LocalFeedbackStore> {
  await ensureLocalStoreFile();

  try {
    const raw = await fs.readFile(getLocalFeedbackStorePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<LocalFeedbackStore>;
    return {
      records: Array.isArray(parsed.records) ? parsed.records as StoredFeedbackRecord[] : [],
    };
  } catch {
    return { records: [] };
  }
}

async function writeLocalStore(data: LocalFeedbackStore): Promise<void> {
  await ensureLocalStoreFile();
  await fs.writeFile(getLocalFeedbackStorePath(), JSON.stringify(data, null, 2), "utf-8");
}

function normalizeFeedbackRecord(record: StoredFeedbackRecord): StoredFeedbackRecord {
  return {
    ...record,
    issues: [...record.issues],
    serviceSnapshots: [...record.serviceSnapshots],
  };
}

function matchesAdminFilters(record: StoredFeedbackRecord, filters: AdminFeedbackListFilters): boolean {
  if (filters.rating && record.rating !== filters.rating) {
    return false;
  }

  if (filters.issueTag && !record.issues.includes(filters.issueTag)) {
    return false;
  }

  const query = filters.query?.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [record.messageText, record.detailText, record.threadName]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => value.toLowerCase().includes(query));
}

function mapStatusRows(rows: StoredFeedbackRecord[]) {
  return new Map(
    rows.map((row) => [
      row.messageKey,
      {
        submitted: true,
        rating: row.rating,
        issues: [...row.issues],
        detailText: row.detailText,
        createdAt: row.createdAt,
      },
    ])
  );
}

function getFeedbackAliases(input: CreateFeedbackInput): string[] {
  return [...new Set([input.userId, ...(input.userAliases ?? [])].filter(Boolean))];
}

async function createLocalFeedback(input: CreateFeedbackInput) {
  warnIfUsingLocalFallback();

  return withLocalWriteLock(async () => {
    const store = await readLocalStore();
    const aliases = getFeedbackAliases(input);
    const existing = store.records.find(
      (record) => record.threadId === input.threadId && record.messageKey === input.messageKey && aliases.includes(record.userId)
    );

    if (existing) {
      const now = new Date().toISOString();
      existing.userId = input.userId;
      existing.userEmail = input.userEmail ?? null;
      existing.userName = input.userName ?? null;
      existing.threadName = input.threadName ?? null;
      existing.messageText = input.messageText;
      existing.rating = input.rating;
      existing.issues = [...input.issues];
      existing.detailText = input.detailText ?? null;
      existing.includeConversationContext = input.includeConversationContext;
      existing.conversationContext = input.conversationContext ?? null;
      existing.submissionContext = input.submissionContext ?? null;
      existing.serviceSnapshots = [...(input.serviceSnapshots ?? [])];
      existing.updatedAt = now;
      await writeLocalStore(store);

      return {
        alreadySubmitted: true,
        wasUpdated: true,
        feedback: normalizeFeedbackRecord(existing),
      };
    }

    const now = new Date().toISOString();
    const record: StoredFeedbackRecord = {
      id: randomUUID(),
      userId: input.userId,
      userEmail: input.userEmail ?? null,
      userName: input.userName ?? null,
      threadId: input.threadId,
      threadName: input.threadName ?? null,
      messageKey: input.messageKey,
      messageText: input.messageText,
      rating: input.rating,
      issues: [...input.issues],
      detailText: input.detailText ?? null,
      includeConversationContext: input.includeConversationContext,
      conversationContext: input.conversationContext ?? null,
      submissionContext: input.submissionContext ?? null,
      serviceSnapshots: [...(input.serviceSnapshots ?? [])],
      createdAt: now,
      updatedAt: now,
    };

    store.records.push(record);
    await writeLocalStore(store);

    return {
      alreadySubmitted: false,
      wasUpdated: false,
      feedback: normalizeFeedbackRecord(record),
    };
  });
}

async function listLocalFeedbackStatusesForUserThread(userIds: string[], threadId: number) {
  warnIfUsingLocalFallback();
  const aliases = [...new Set(userIds.filter(Boolean))];
  if (aliases.length === 0) {
    return new Map();
  }

  const store = await readLocalStore();
  const rows = store.records.filter((record) => record.threadId === threadId && aliases.includes(record.userId));
  return mapStatusRows(rows);
}

async function listLocalAdminFeedback(filters: AdminFeedbackListFilters) {
  warnIfUsingLocalFallback();
  const take = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const store = await readLocalStore();
  const filtered = store.records
    .filter((record) => matchesAdminFilters(record, filters))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return {
    total: filtered.length,
    results: filtered.slice(0, take).map(normalizeFeedbackRecord),
  };
}

async function getLocalAdminFeedbackById(id: string) {
  warnIfUsingLocalFallback();
  const store = await readLocalStore();
  const record = store.records.find((candidate) => candidate.id === id);
  return record ? normalizeFeedbackRecord(record) : null;
}

function getPostgresPool(): Pool {
  const existingPool = globalForFeedbackStore.feedbackPostgresPool;
  if (existingPool) {
    return existingPool;
  }

  const connectionString = getConfiguredPostgresUrl();
  if (!connectionString) {
    throw new Error("Missing FEEDBACK_DATABASE_URL or FEEDBACK_DB_* configuration");
  }

  const pool = new Pool({
    connectionString,
    ssl: isTruthy(process.env.FEEDBACK_DB_SSL) ? { rejectUnauthorized: false } : undefined,
  });

  globalForFeedbackStore.feedbackPostgresPool = pool;
  return pool;
}

async function ensurePostgresSchema() {
  if (globalForFeedbackStore.feedbackPostgresSchemaPromise) {
    return globalForFeedbackStore.feedbackPostgresSchemaPromise;
  }

  const pool = getPostgresPool();
  globalForFeedbackStore.feedbackPostgresSchemaPromise = (async () => {
    const client = await pool.connect();

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS message_feedback (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          user_email TEXT,
          user_name TEXT,
          thread_id INTEGER NOT NULL,
          thread_name TEXT,
          message_key TEXT NOT NULL,
          message_text TEXT NOT NULL,
          rating TEXT NOT NULL,
          detail_text TEXT,
          include_conversation_context BOOLEAN NOT NULL DEFAULT TRUE,
          conversation_context_json JSONB,
          submission_context_json JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS idx_message_feedback_thread_created_at ON message_feedback(thread_id, created_at DESC)");
      await client.query("CREATE INDEX IF NOT EXISTS idx_message_feedback_rating_created_at ON message_feedback(rating, created_at DESC)");
      await client.query("CREATE INDEX IF NOT EXISTS idx_message_feedback_user_thread_message ON message_feedback(user_id, thread_id, message_key)");

      await client.query(`
        CREATE TABLE IF NOT EXISTS feedback_issue_selection (
          feedback_id TEXT NOT NULL REFERENCES message_feedback(id) ON DELETE CASCADE,
          tag TEXT NOT NULL,
          PRIMARY KEY (feedback_id, tag)
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS idx_feedback_issue_selection_tag ON feedback_issue_selection(tag)");

      await client.query(`
        CREATE TABLE IF NOT EXISTS feedback_service_snapshot (
          id BIGSERIAL PRIMARY KEY,
          feedback_id TEXT NOT NULL REFERENCES message_feedback(id) ON DELETE CASCADE,
          service TEXT NOT NULL,
          version TEXT,
          commit_sha TEXT,
          image_tag TEXT,
          model_name TEXT,
          metadata_json JSONB
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS idx_feedback_service_snapshot_service ON feedback_service_snapshot(service)");
    } finally {
      client.release();
    }
  })();

  return globalForFeedbackStore.feedbackPostgresSchemaPromise;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function fetchPostgresIssues(pool: Pool, ids: string[]) {
  if (ids.length === 0) {
    return new Map<string, string[]>();
  }

  const result = await pool.query<PostgresIssueRow>(
    "SELECT feedback_id, tag FROM feedback_issue_selection WHERE feedback_id = ANY($1::text[]) ORDER BY tag ASC",
    [ids]
  );
  const map = new Map<string, string[]>();
  for (const row of result.rows) {
    const existing = map.get(row.feedback_id) ?? [];
    existing.push(row.tag);
    map.set(row.feedback_id, existing);
  }
  return map;
}

async function fetchPostgresSnapshots(pool: Pool, ids: string[]) {
  if (ids.length === 0) {
    return new Map<string, FeedbackServiceSnapshot[]>();
  }

  const result = await pool.query<PostgresSnapshotRow>(
    `SELECT feedback_id, service, version, commit_sha, image_tag, model_name, metadata_json
     FROM feedback_service_snapshot
     WHERE feedback_id = ANY($1::text[])
     ORDER BY id ASC`,
    [ids]
  );
  const map = new Map<string, FeedbackServiceSnapshot[]>();
  for (const row of result.rows) {
    const existing = map.get(row.feedback_id) ?? [];
    existing.push({
      service: row.service,
      version: row.version,
      commitSha: row.commit_sha,
      imageTag: row.image_tag,
      modelName: row.model_name,
      metadata: (row.metadata_json ?? null) as Record<string, unknown> | null,
    });
    map.set(row.feedback_id, existing);
  }
  return map;
}

function hydratePostgresRecords(
  rows: PostgresFeedbackRow[],
  issuesById: Map<string, string[]>,
  snapshotsById: Map<string, FeedbackServiceSnapshot[]>
): StoredFeedbackRecord[] {
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    threadId: row.thread_id,
    threadName: row.thread_name,
    messageKey: row.message_key,
    messageText: row.message_text,
    rating: row.rating,
    issues: issuesById.get(row.id) ?? [],
    detailText: row.detail_text,
    includeConversationContext: row.include_conversation_context,
    conversationContext: row.conversation_context_json ?? null,
    submissionContext: row.submission_context_json ?? null,
    serviceSnapshots: snapshotsById.get(row.id) ?? [],
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }));
}

function buildPostgresFilter(filters: AdminFeedbackListFilters) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.rating) {
    params.push(filters.rating);
    clauses.push(`mf.rating = $${params.length}`);
  }

  if (filters.issueTag) {
    params.push(filters.issueTag);
    clauses.push(`EXISTS (SELECT 1 FROM feedback_issue_selection fis WHERE fis.feedback_id = mf.id AND fis.tag = $${params.length})`);
  }

  const query = filters.query?.trim();
  if (query) {
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    const baseIndex = params.length - 2;
    clauses.push(`(
      mf.message_text ILIKE $${baseIndex}
      OR COALESCE(mf.detail_text, '') ILIKE $${baseIndex + 1}
      OR COALESCE(mf.thread_name, '') ILIKE $${baseIndex + 2}
    )`);
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

async function createPostgresFeedback(input: CreateFeedbackInput) {
  const pool = getPostgresPool();
  await ensurePostgresSchema();
  const aliases = getFeedbackAliases(input);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query<PostgresFeedbackRow>(
      `SELECT *
       FROM message_feedback
       WHERE thread_id = $1 AND message_key = $2 AND user_id = ANY($3::text[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.threadId, input.messageKey, aliases]
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      await client.query(
        `UPDATE message_feedback
         SET user_id = $2,
             user_email = $3,
             user_name = $4,
             thread_name = $5,
             message_text = $6,
             rating = $7,
             detail_text = $8,
             include_conversation_context = $9,
             conversation_context_json = $10::jsonb,
             submission_context_json = $11::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          row.id,
          input.userId,
          input.userEmail ?? null,
          input.userName ?? null,
          input.threadName ?? null,
          input.messageText,
          input.rating,
          input.detailText ?? null,
          input.includeConversationContext,
          input.conversationContext != null ? JSON.stringify(input.conversationContext) : null,
          input.submissionContext != null ? JSON.stringify(input.submissionContext) : null,
        ]
      );
      await client.query("DELETE FROM feedback_issue_selection WHERE feedback_id = $1", [row.id]);
      await client.query("DELETE FROM feedback_service_snapshot WHERE feedback_id = $1", [row.id]);

      for (const tag of input.issues) {
        await client.query(
          "INSERT INTO feedback_issue_selection (feedback_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [row.id, tag]
        );
      }

      for (const snapshot of input.serviceSnapshots ?? []) {
        await client.query(
          `INSERT INTO feedback_service_snapshot (
            feedback_id, service, version, commit_sha, image_tag, model_name, metadata_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            row.id,
            snapshot.service,
            snapshot.version ?? null,
            snapshot.commitSha ?? null,
            snapshot.imageTag ?? null,
            snapshot.modelName ?? null,
            snapshot.metadata != null ? JSON.stringify(snapshot.metadata) : null,
          ]
        );
      }

      const updatedRows = await client.query<PostgresFeedbackRow>(
        "SELECT * FROM message_feedback WHERE id = $1 LIMIT 1",
        [row.id]
      );
      await client.query("COMMIT");

      const issuesById = await fetchPostgresIssues(pool, [row.id]);
      const snapshotsById = await fetchPostgresSnapshots(pool, [row.id]);
      return {
        alreadySubmitted: true,
        wasUpdated: true,
        feedback: hydratePostgresRecords(updatedRows.rows, issuesById, snapshotsById)[0],
      };
    }

    const id = randomUUID();
    const inserted = await client.query<PostgresFeedbackRow>(
      `INSERT INTO message_feedback (
        id, user_id, user_email, user_name, thread_id, thread_name, message_key, message_text,
        rating, detail_text, include_conversation_context, conversation_context_json,
        submission_context_json, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12::jsonb,
        $13::jsonb, NOW(), NOW()
      ) RETURNING *`,
      [
        id,
        input.userId,
        input.userEmail ?? null,
        input.userName ?? null,
        input.threadId,
        input.threadName ?? null,
        input.messageKey,
        input.messageText,
        input.rating,
        input.detailText ?? null,
        input.includeConversationContext,
        input.conversationContext != null ? JSON.stringify(input.conversationContext) : null,
        input.submissionContext != null ? JSON.stringify(input.submissionContext) : null,
      ]
    );

    for (const tag of input.issues) {
      await client.query(
        "INSERT INTO feedback_issue_selection (feedback_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [id, tag]
      );
    }

    for (const snapshot of input.serviceSnapshots ?? []) {
      await client.query(
        `INSERT INTO feedback_service_snapshot (
          feedback_id, service, version, commit_sha, image_tag, model_name, metadata_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          id,
          snapshot.service,
          snapshot.version ?? null,
          snapshot.commitSha ?? null,
          snapshot.imageTag ?? null,
          snapshot.modelName ?? null,
          snapshot.metadata != null ? JSON.stringify(snapshot.metadata) : null,
        ]
      );
    }

    await client.query("COMMIT");

    const issuesById = await fetchPostgresIssues(pool, [id]);
    const snapshotsById = await fetchPostgresSnapshots(pool, [id]);
    return {
      alreadySubmitted: false,
      wasUpdated: false,
      feedback: hydratePostgresRecords(inserted.rows, issuesById, snapshotsById)[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listPostgresFeedbackStatusesForUserThread(userIds: string[], threadId: number) {
  const aliases = [...new Set(userIds.filter(Boolean))];
  if (aliases.length === 0) {
    return new Map();
  }

  const pool = getPostgresPool();
  await ensurePostgresSchema();

  const result = await pool.query<PostgresFeedbackRow>(
    `SELECT * FROM message_feedback WHERE thread_id = $1 AND user_id = ANY($2::text[]) ORDER BY created_at DESC`,
    [threadId, aliases]
  );

  const ids = result.rows.map((row: PostgresFeedbackRow) => row.id);
  const issuesById = await fetchPostgresIssues(pool, ids);
  return mapStatusRows(hydratePostgresRecords(result.rows, issuesById, new Map()));
}

async function listPostgresAdminFeedback(filters: AdminFeedbackListFilters) {
  const pool = getPostgresPool();
  await ensurePostgresSchema();
  const take = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const { whereClause, params } = buildPostgresFilter(filters);

  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM message_feedback mf ${whereClause}`,
    params
  );

  const rowsResult = await pool.query<PostgresFeedbackRow>(
    `SELECT * FROM message_feedback mf ${whereClause} ORDER BY mf.created_at DESC LIMIT $${params.length + 1}`,
    [...params, take]
  );

  const ids = rowsResult.rows.map((row: PostgresFeedbackRow) => row.id);
  const [issuesById, snapshotsById] = await Promise.all([
    fetchPostgresIssues(pool, ids),
    fetchPostgresSnapshots(pool, ids),
  ]);

  return {
    total: Number(countResult.rows[0]?.total ?? 0),
    results: hydratePostgresRecords(rowsResult.rows, issuesById, snapshotsById),
  };
}

async function getPostgresAdminFeedbackById(id: string) {
  const pool = getPostgresPool();
  await ensurePostgresSchema();

  const rowsResult = await pool.query<PostgresFeedbackRow>(
    "SELECT * FROM message_feedback WHERE id = $1 LIMIT 1",
    [id]
  );

  if (!rowsResult.rows[0]) {
    return null;
  }

  const [issuesById, snapshotsById] = await Promise.all([
    fetchPostgresIssues(pool, [id]),
    fetchPostgresSnapshots(pool, [id]),
  ]);

  return hydratePostgresRecords(rowsResult.rows, issuesById, snapshotsById)[0] ?? null;
}

export async function createMessageFeedback(input: CreateFeedbackInput) {
  if (getFeedbackStorageInfo().kind === "postgres") {
    return createPostgresFeedback(input);
  }

  return createLocalFeedback(input);
}

export async function listFeedbackStatusesForUserThread(userIds: string[], threadId: number) {
  if (getFeedbackStorageInfo().kind === "postgres") {
    return listPostgresFeedbackStatusesForUserThread(userIds, threadId);
  }

  return listLocalFeedbackStatusesForUserThread(userIds, threadId);
}

export async function listAdminFeedback(filters: AdminFeedbackListFilters) {
  if (getFeedbackStorageInfo().kind === "postgres") {
    return listPostgresAdminFeedback(filters);
  }

  return listLocalAdminFeedback(filters);
}

export async function getAdminFeedbackById(id: string) {
  if (getFeedbackStorageInfo().kind === "postgres") {
    return getPostgresAdminFeedbackById(id);
  }

  return getLocalAdminFeedbackById(id);
}