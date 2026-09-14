import { randomBytes } from "crypto";
import { createKvStore, type KvBackend } from "@/lib/kvStore";

export type JobEntry = {
  sub: string;
  threadId: number | null;
  rasaUrl: string;
  createdAt: number;
  expiresAt: number;
};

const JOB_STORE_BACKEND = (process.env.JOB_STORE_BACKEND || "memory").trim().toLowerCase() as KvBackend;
const JOB_STORE_REDIS_URL = (process.env.JOB_STORE_REDIS_URL || "").trim();
const JOB_STORE_REDIS_PREFIX = (process.env.JOB_STORE_REDIS_PREFIX || "cva:job:").trim();

// Must exceed the longest realistic long-running action, since touchJob only
// extends the TTL on each callback/proxy hit -- a job that outlives this
// without an interaction is presumed abandoned.
const JOB_TTL_SECONDS = Number(process.env.JOB_ID_TTL_SECONDS ?? 30 * 60);

const store = createKvStore({
  backend: JOB_STORE_BACKEND,
  redisUrl: JOB_STORE_REDIS_URL,
  redisKeyPrefix: JOB_STORE_REDIS_PREFIX,
  globalMemoryMapKey: "jobStoreMemoryMap",
  globalRedisClientKey: "jobStoreRedisClient",
});

function generateJobId(): string {
  // Opaque bearer capability for the job's lifetime -- must be unguessable,
  // not sequential. Treat like a secret in logs.
  return randomBytes(32).toString("base64url");
}

export async function createJob(params: {
  sub: string;
  threadId: number | null;
  rasaUrl: string;
}): Promise<string> {
  const jobId = generateJobId();
  const now = Date.now();
  const entry: JobEntry = {
    sub: params.sub,
    threadId: params.threadId,
    rasaUrl: params.rasaUrl,
    createdAt: now,
    expiresAt: now + JOB_TTL_SECONDS * 1000,
  };
  await store.set(jobId, JSON.stringify(entry), JOB_TTL_SECONDS);
  return jobId;
}

export async function getJob(jobId: string): Promise<JobEntry | null> {
  if (!jobId) return null;
  const raw = await store.get(jobId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JobEntry;
  } catch {
    await store.del(jobId);
    return null;
  }
}

export async function touchJob(jobId: string): Promise<void> {
  const entry = await getJob(jobId);
  if (!entry) return;
  entry.expiresAt = Date.now() + JOB_TTL_SECONDS * 1000;
  await store.set(jobId, JSON.stringify(entry), JOB_TTL_SECONDS);
}

export async function deleteJob(jobId: string): Promise<void> {
  if (!jobId) return;
  await store.del(jobId);
}
