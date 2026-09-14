import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// JOB_TTL_SECONDS is read once at module load, so set it before importing
// and always re-import fresh per test via vi.resetModules(). Force the
// memory backend explicitly -- this file tests real module logic (not a
// mock), so it must not depend on whatever JOB_STORE_BACKEND happens to be
// set to in the ambient environment (the shared devcontainer runs with
// JOB_STORE_BACKEND=redis for real usage).
vi.hoisted(() => {
  process.env.JOB_ID_TTL_SECONDS = "60";
  process.env.JOB_STORE_BACKEND = "memory";
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("jobStore (memory backend)", () => {
  it("creates a job, retrieves it, and returns an unguessable opaque id", async () => {
    const { createJob, getJob } = await import("@/lib/jobStore");

    const jobId = await createJob({ sub: "u1", threadId: 12, rasaUrl: "http://rasa:5005" });

    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(30);

    const job = await getJob(jobId);
    expect(job).toMatchObject({ sub: "u1", threadId: 12, rasaUrl: "http://rasa:5005" });
  });

  it("returns null for an unknown jobId", async () => {
    const { getJob } = await import("@/lib/jobStore");
    expect(await getJob("does-not-exist")).toBeNull();
  });

  it("expires a job after its TTL elapses", async () => {
    const { createJob, getJob } = await import("@/lib/jobStore");
    const jobId = await createJob({ sub: "u1", threadId: null, rasaUrl: "http://rasa:5005" });

    vi.setSystemTime(59_000);
    expect(await getJob(jobId)).not.toBeNull();

    vi.setSystemTime(61_000);
    expect(await getJob(jobId)).toBeNull();
  });

  it("touchJob slides the expiry forward", async () => {
    const { createJob, getJob, touchJob } = await import("@/lib/jobStore");
    const jobId = await createJob({ sub: "u1", threadId: null, rasaUrl: "http://rasa:5005" });

    vi.setSystemTime(59_000);
    await touchJob(jobId);

    // Without the touch this would already be past the original 60s TTL.
    vi.setSystemTime(100_000);
    expect(await getJob(jobId)).not.toBeNull();
  });

  it("touchJob on an unknown jobId is a harmless no-op", async () => {
    const { touchJob } = await import("@/lib/jobStore");
    await expect(touchJob("does-not-exist")).resolves.toBeUndefined();
  });

  it("deleteJob removes the entry", async () => {
    const { createJob, getJob, deleteJob } = await import("@/lib/jobStore");
    const jobId = await createJob({ sub: "u1", threadId: null, rasaUrl: "http://rasa:5005" });

    await deleteJob(jobId);
    expect(await getJob(jobId)).toBeNull();
  });
});
