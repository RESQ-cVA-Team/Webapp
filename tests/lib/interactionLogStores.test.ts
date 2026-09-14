import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let settingsPath: string;
let entriesPath: string;
let tmpDir: string;

const ORIGINAL_ENV = {
  INTERACTION_LOG_LOCAL_STORE_PATH: process.env.INTERACTION_LOG_LOCAL_STORE_PATH,
  INTERACTION_LOG_LOCAL_ENTRIES_PATH: process.env.INTERACTION_LOG_LOCAL_ENTRIES_PATH,
  INTERACTION_LOG_DATABASE_URL: process.env.INTERACTION_LOG_DATABASE_URL,
  INTERACTION_LOG_DB_HOST: process.env.INTERACTION_LOG_DB_HOST,
};

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "interaction-log-test-"));
  settingsPath = path.join(tmpDir, "settings.json");
  entriesPath = path.join(tmpDir, "entries.json");
  process.env.INTERACTION_LOG_LOCAL_STORE_PATH = settingsPath;
  process.env.INTERACTION_LOG_LOCAL_ENTRIES_PATH = entriesPath;
  delete process.env.INTERACTION_LOG_DATABASE_URL;
  delete process.env.INTERACTION_LOG_DB_HOST;
  // Fresh module state per test -- these modules cache their store path
  // resolution indirectly via globalThis-pinned queues, so reset between runs.
  await import("@/lib/interactionLogSettingsStore").then(() => undefined);
});

afterEach(() => {
  process.env.INTERACTION_LOG_LOCAL_STORE_PATH = ORIGINAL_ENV.INTERACTION_LOG_LOCAL_STORE_PATH;
  process.env.INTERACTION_LOG_LOCAL_ENTRIES_PATH = ORIGINAL_ENV.INTERACTION_LOG_LOCAL_ENTRIES_PATH;
  process.env.INTERACTION_LOG_DATABASE_URL = ORIGINAL_ENV.INTERACTION_LOG_DATABASE_URL;
  process.env.INTERACTION_LOG_DB_HOST = ORIGINAL_ENV.INTERACTION_LOG_DB_HOST;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("interactionLogSettingsStore (local-file backend)", () => {
  it("creates sane defaults on first read", async () => {
    const { readInteractionLogSettings } = await import("@/lib/interactionLogSettingsStore");
    const settings = await readInteractionLogSettings();

    expect(settings.masterEnabled).toBe(false);
    expect(settings.mode).toBe("allowlist");
    expect(settings.storageIdentityMode).toBe("identified");
  });

  it("writes and clamps settings, then reads them back", async () => {
    const { readInteractionLogSettings, writeInteractionLogSettings } = await import("@/lib/interactionLogSettingsStore");

    const written = await writeInteractionLogSettings({
      masterEnabled: true,
      mode: "allowlist",
      allowlistEmails: ["Admin@Example.com", "admin@example.com"],
      samplePercentage: 500,
      retentionDays: 100000,
      storageIdentityMode: "pseudonymous",
      updatedByEmail: "admin@example.com",
    });

    expect(written.masterEnabled).toBe(true);
    expect(written.allowlistEmails).toEqual(["admin@example.com"]);
    expect(written.samplePercentage).toBe(100);
    expect(written.retentionDays).toBeLessThanOrEqual(90);
    expect(written.storageIdentityMode).toBe("pseudonymous");

    const reread = await readInteractionLogSettings();
    expect(reread).toEqual(written);
  });
});

describe("interactionLogStore (local-file backend)", () => {
  it("creates an entry and lists it back", async () => {
    const { upsertInteractionLogEntry, listInteractionLogEntries } = await import("@/lib/interactionLogStore");

    await upsertInteractionLogEntry({
      identityMode: "identified",
      userSub: "sub-1",
      userEmail: "user@example.com",
      userName: "Test User",
      userPseudonym: null,
      threadId: 1,
      senderId: "sub-1:thread:1",
      source: "sync",
      traceId: "trace-1",
      history: [{ role: "user", text: "hi" }],
      serviceSnapshots: [],
      retentionDays: 30,
    });

    const { total, results } = await listInteractionLogEntries({});
    expect(total).toBe(1);
    expect(results[0].userEmail).toBe("user@example.com");
    expect(results[0].history).toEqual([{ role: "user", text: "hi" }]);
  });

  it("upserts by senderId instead of inserting a new row per turn", async () => {
    const { upsertInteractionLogEntry, listInteractionLogEntries } = await import("@/lib/interactionLogStore");

    const first = await upsertInteractionLogEntry({
      identityMode: "identified",
      userSub: "sub-1",
      userEmail: "user@example.com",
      userName: null,
      userPseudonym: null,
      threadId: 1,
      senderId: "sub-1:thread:1",
      source: "sync",
      traceId: "trace-1",
      history: [{ role: "user", text: "hi" }],
      serviceSnapshots: [],
      retentionDays: 30,
    });

    const second = await upsertInteractionLogEntry({
      identityMode: "identified",
      userSub: "sub-1",
      userEmail: "user@example.com",
      userName: null,
      userPseudonym: null,
      threadId: 1,
      senderId: "sub-1:thread:1",
      source: "sync",
      traceId: "trace-2",
      history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }, { role: "user", text: "again" }],
      serviceSnapshots: [],
      retentionDays: 30,
    });

    // Same conversation -> same row (stable id), history replaced with the
    // latest cumulative snapshot, not appended as a second row.
    expect(second.id).toBe(first.id);

    const { total, results } = await listInteractionLogEntries({});
    expect(total).toBe(1);
    expect(results[0].history).toHaveLength(3);
    expect(results[0].traceId).toBe("trace-2");
  });

  it("filters by user email and source", async () => {
    const { upsertInteractionLogEntry, listInteractionLogEntries } = await import("@/lib/interactionLogStore");

    await upsertInteractionLogEntry({
      identityMode: "identified",
      userSub: "sub-1",
      userEmail: "user@example.com",
      userName: null,
      userPseudonym: null,
      threadId: 1,
      senderId: "sub-1:thread:1",
      source: "sync",
      traceId: null,
      history: [{ role: "user", text: "hi" }],
      serviceSnapshots: [],
      retentionDays: 30,
    });
    await upsertInteractionLogEntry({
      identityMode: "identified",
      userSub: "sub-2",
      userEmail: "other@example.com",
      userName: null,
      userPseudonym: null,
      threadId: 2,
      senderId: "sub-2:thread:2",
      source: "long-task-callback",
      traceId: null,
      history: [{ role: "user", text: "hello" }],
      serviceSnapshots: [],
      retentionDays: 30,
    });

    const byEmail = await listInteractionLogEntries({ userEmail: "user@example.com" });
    expect(byEmail.total).toBe(1);
    expect(byEmail.results[0].userEmail).toBe("user@example.com");

    const bySource = await listInteractionLogEntries({ source: "long-task-callback" });
    expect(bySource.total).toBe(1);
    expect(bySource.results[0].userEmail).toBe("other@example.com");
  });

  it("does not purge an entry whose retention window hasn't elapsed", async () => {
    const { upsertInteractionLogEntry, listInteractionLogEntries } = await import("@/lib/interactionLogStore");

    const entry = await upsertInteractionLogEntry({
      identityMode: "identified",
      userSub: "sub-1",
      userEmail: "user@example.com",
      userName: null,
      userPseudonym: null,
      threadId: null,
      senderId: "sub-1",
      source: "sync",
      traceId: null,
      history: [{ role: "user", text: "hi" }],
      serviceSnapshots: [],
      retentionDays: 30,
    });

    expect(new Date(entry.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const { total } = await listInteractionLogEntries({});
    expect(total).toBe(1);
  });

  it("actually deletes an expired entry, lazily, on the next write", async () => {
    const { upsertInteractionLogEntry, listInteractionLogEntries } = await import("@/lib/interactionLogStore");

    // A negative retention window is never reachable through the settings
    // API (clamped to >= 1 there), but the store layer itself doesn't
    // clamp -- using it here to deterministically produce an
    // already-expired row without waiting or hand-editing files, so the
    // real deletion codepath (not just "not yet expired") gets exercised.
    await upsertInteractionLogEntry({
      identityMode: "identified",
      userSub: "sub-expired",
      userEmail: "expired@example.com",
      userName: null,
      userPseudonym: null,
      threadId: null,
      senderId: "sub-expired",
      source: "sync",
      traceId: null,
      history: [{ role: "user", text: "hi" }],
      serviceSnapshots: [],
      retentionDays: -1,
    });

    const beforePurge = await listInteractionLogEntries({ userEmail: "expired@example.com" });
    expect(beforePurge.total).toBe(0); // list() itself purges expired rows before reading

    // A second, unrelated write should also trigger purge-on-write and not
    // resurrect the expired row.
    await upsertInteractionLogEntry({
      identityMode: "identified",
      userSub: "sub-fresh",
      userEmail: "fresh@example.com",
      userName: null,
      userPseudonym: null,
      threadId: null,
      senderId: "sub-fresh",
      source: "sync",
      traceId: null,
      history: [{ role: "user", text: "hi" }],
      serviceSnapshots: [],
      retentionDays: 30,
    });

    const { total, results } = await listInteractionLogEntries({});
    expect(total).toBe(1);
    expect(results[0].userEmail).toBe("fresh@example.com");
  });
});
