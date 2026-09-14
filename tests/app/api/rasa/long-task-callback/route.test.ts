import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- hoisted mocks ---
const fetchRasaTrackerEventsMock = vi.hoisted(() => vi.fn());
const mapRasaTrackerEventsMock = vi.hoisted(() => vi.fn());
const publishCommittedHistoryItemsMock = vi.hoisted(() => vi.fn());
const publishToSenderMock = vi.hoisted(() => vi.fn());
const setCommittedCursorFloorMock = vi.hoisted(() => vi.fn());
const getRasaBotsMock = vi.hoisted(() => vi.fn());
const withRasaAuthMock = vi.hoisted(() => vi.fn((url: string) => url));
const fetchMock = vi.hoisted(() => vi.fn());
const getJobMock = vi.hoisted(() => vi.fn());
const touchJobMock = vi.hoisted(() => vi.fn());
const verifyActionServiceBearerMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rasaHistory", () => ({
  fetchRasaTrackerEvents: fetchRasaTrackerEventsMock,
  mapRasaTrackerEvents: mapRasaTrackerEventsMock,
}));
vi.mock("@/lib/sseBus", () => ({
  publishCommittedHistoryItems: publishCommittedHistoryItemsMock,
  publishToSender: publishToSenderMock,
  setCommittedCursorFloor: setCommittedCursorFloorMock,
}));
vi.mock("@/lib/rasaConfig", () => ({
  getRasaBots: getRasaBotsMock,
  withRasaAuth: withRasaAuthMock,
}));
vi.mock("@/lib/jobStore", () => ({
  getJob: getJobMock,
  touchJob: touchJobMock,
}));
vi.mock("@/lib/keycloakIntrospect", () => ({
  verifyActionServiceBearer: verifyActionServiceBearerMock,
}));
vi.mock("@/lib/traceId", () => ({
  readTraceId: () => null,
  normalizeTraceId: (v: unknown) => (typeof v === "string" ? v.trim() || null : null),
  withTraceIdHeaders: () => ({}),
  createTraceLogContext: (_: unknown, extra?: unknown) => extra ?? {},
  createTraceErrorResponse: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}));

vi.stubGlobal("fetch", fetchMock);

const DEFAULT_JOB = { sub: "u1", threadId: 1, rasaUrl: "http://rasa:5005", createdAt: 0, expiresAt: 0 };

beforeEach(() => {
  fetchRasaTrackerEventsMock.mockReset();
  mapRasaTrackerEventsMock.mockReset();
  publishCommittedHistoryItemsMock.mockReset();
  publishToSenderMock.mockReset();
  setCommittedCursorFloorMock.mockReset();
  getRasaBotsMock.mockReset();
  fetchMock.mockReset();
  getJobMock.mockReset();
  touchJobMock.mockReset();
  verifyActionServiceBearerMock.mockReset();
  verifyActionServiceBearerMock.mockResolvedValue(true);
  withRasaAuthMock.mockImplementation((url: string) => url);
  mapRasaTrackerEventsMock.mockReturnValue([]);
  publishCommittedHistoryItemsMock.mockReturnValue(0);
  getRasaBotsMock.mockReturnValue([{ url: "http://rasa:5005", lang: "en" }]);
  getJobMock.mockResolvedValue(DEFAULT_JOB);
  touchJobMock.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

import { POST } from "@/app/api/rasa/long-task-callback/route";

function makeRequest(
  body: Record<string, unknown>,
  opts: { jobId?: string } = {}
): NextRequest {
  const jobId = "jobId" in opts ? opts.jobId : "job-1";
  const url = jobId
    ? `http://localhost/api/rasa/long-task-callback?jobId=${encodeURIComponent(jobId)}`
    : "http://localhost/api/rasa/long-task-callback";
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-service-token",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rasa/long-task-callback", () => {
  it("returns 401 when the caller's service credentials don't verify", async () => {
    verifyActionServiceBearerMock.mockResolvedValue(false);
    const res = await POST(makeRequest({ events: [], controls: [] }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when jobId is missing from the callback URL", async () => {
    const res = await POST(
      makeRequest({ events: [], controls: [] } as never, { jobId: undefined })
    );
    expect(res.status).toBe(400);
    expect(getJobMock).not.toHaveBeenCalled();
  });

  it("returns 401 when jobId doesn't resolve to a known job (unknown or expired)", async () => {
    getJobMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest(
        { events: [{ event: "bot", text: "hi" }], controls: [] },
        { jobId: "stale-or-forged" }
      )
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves identity from the job, ignoring any senderId in the body", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    fetchRasaTrackerEventsMock.mockResolvedValue({ events: [], error: undefined, status: 200 });

    const res = await POST(
      makeRequest({
        senderId: "attacker:thread:1",
        events: [{ event: "bot", text: "hi", data: {} }],
        controls: [],
      })
    );

    expect(res.status).toBe(200);
    // Tracker events are persisted against the jobId-resolved sender, not
    // whatever the body claimed.
    const trackerPost = (fetchMock.mock.calls as Array<unknown[]>).find(
      (args) => typeof args[0] === "string" && args[0].includes("/tracker/events")
    );
    expect(trackerPost?.[0]).toContain("/conversations/u1:thread:1/tracker/events");
  });

  it("returns 400 when events and controls are both empty", async () => {
    const res = await POST(
      makeRequest({ events: [], controls: [] })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the job's stored rasaUrl is not an allowed bot", async () => {
    getJobMock.mockResolvedValue({ ...DEFAULT_JOB, rasaUrl: "http://evil.host:9999" });
    const res = await POST(
      makeRequest({ events: [{ event: "bot", text: "hi" }], controls: [] })
    );
    expect(res.status).toBe(400);
  });

  it("persists tracker events and publishes committed delta", async () => {
    const trackerEvents = [
      { event: "session_started" },
      { event: "user", text: "hi" },
      { event: "bot", text: "hello" },
    ];

    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    fetchRasaTrackerEventsMock.mockResolvedValue({
      events: trackerEvents,
      error: undefined,
      status: 200,
    });
    mapRasaTrackerEventsMock.mockReturnValue([
      { role: "assistant", text: "hello", feedbackKey: "bot:2", debug: { eventIndex: 2, turnIndex: 1 } },
    ]);
    publishCommittedHistoryItemsMock.mockReturnValue(1);

    const res = await POST(
      makeRequest({
        events: [{ event: "bot", text: "hello", data: {} }],
        controls: [],
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(publishCommittedHistoryItemsMock).toHaveBeenCalledOnce();
    expect(touchJobMock).toHaveBeenCalledWith("job-1");
  });

  it("publishes controls (lock/release) directly to SSE bus without saving to tracker", async () => {
    fetchRasaTrackerEventsMock.mockResolvedValue({
      events: [],
      error: undefined,
      status: 200,
    });

    const res = await POST(
      makeRequest({
        events: [],
        controls: [{ type: "lock", jobId: "job-abc", scope: "long_action" }],
      })
    );

    expect(res.status).toBe(200);
    expect(publishToSenderMock).toHaveBeenCalledWith(
      "u1:thread:1",
      // The route spreads control (which has type: "lock") after { type: "control" },
      // so the spread overwrites and the published type is "lock".
      expect.objectContaining({ type: "lock", jobId: "job-abc" })
    );
    // Tracker POST should NOT have been called for controls-only payload
    const trackerPosts = (fetchMock.mock.calls as Array<unknown[]>).filter(
      (args) => typeof args[0] === "string" && args[0].includes("/tracker/events")
    );
    expect(trackerPosts).toHaveLength(0);
  });

  it("returns 502 when persisting to tracker fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => "Bad gateway" });

    const res = await POST(
      makeRequest({
        events: [{ event: "bot", text: "hi", data: {} }],
        controls: [],
      })
    );

    expect(res.status).toBe(502);
  });
});
