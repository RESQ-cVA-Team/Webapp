import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Set the callback token env var before the module is imported so the
// module-level constant `LONG_TASK_CALLBACK_TOKEN` reads the right value.
// NOTE: do NOT reference outer `const` from vi.hoisted — it runs before the
// module body, so outer bindings are in the temporal dead zone.
vi.hoisted(() => { process.env.LONG_TASK_CALLBACK_TOKEN = "test-callback-token"; });
const VALID_TOKEN = "test-callback-token";

// --- hoisted mocks ---
const fetchRasaTrackerEventsMock = vi.hoisted(() => vi.fn());
const mapRasaTrackerEventsMock = vi.hoisted(() => vi.fn());
const publishCommittedHistoryItemsMock = vi.hoisted(() => vi.fn());
const publishToSenderMock = vi.hoisted(() => vi.fn());
const setCommittedCursorFloorMock = vi.hoisted(() => vi.fn());
const getRasaBotsMock = vi.hoisted(() => vi.fn());
const withRasaAuthMock = vi.hoisted(() => vi.fn((url: string) => url));
const fetchMock = vi.hoisted(() => vi.fn());

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
vi.mock("@/lib/traceId", () => ({
  readTraceId: () => null,
  normalizeTraceId: (v: unknown) => (typeof v === "string" ? v.trim() || null : null),
  withTraceIdHeaders: () => ({}),
  createTraceLogContext: (_: unknown, extra?: unknown) => extra ?? {},
  createTraceErrorResponse: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}));

vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchRasaTrackerEventsMock.mockReset();
  mapRasaTrackerEventsMock.mockReset();
  publishCommittedHistoryItemsMock.mockReset();
  publishToSenderMock.mockReset();
  setCommittedCursorFloorMock.mockReset();
  getRasaBotsMock.mockReset();
  fetchMock.mockReset();
  withRasaAuthMock.mockImplementation((url: string) => url);
  mapRasaTrackerEventsMock.mockReturnValue([]);
  publishCommittedHistoryItemsMock.mockReturnValue(0);
  getRasaBotsMock.mockReturnValue([{ url: "http://rasa:5005", lang: "en" }]);
});

afterEach(() => vi.restoreAllMocks());

import { POST } from "@/app/api/rasa/long-task-callback/route";

function makeRequest(
  body: Record<string, unknown>,
  opts: { token?: string; rasaUrl?: string } = {}
): NextRequest {
  const rasaUrl = opts.rasaUrl ?? "http://rasa:5005";
  const token = opts.token ?? VALID_TOKEN;
  const url = `http://localhost/api/rasa/long-task-callback?rasaUrl=${encodeURIComponent(rasaUrl)}&senderId=${encodeURIComponent(body.senderId as string)}`;
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-long-task-callback-token": token,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rasa/long-task-callback", () => {
  it("returns 401 with wrong token", async () => {
    const res = await POST(
      makeRequest({ senderId: "u1:thread:1", events: [], controls: [] }, { token: "wrong" })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when body has no senderId", async () => {
    const res = await POST(
      makeRequest({ events: [], controls: [] } as never)
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when events and controls are both empty", async () => {
    const res = await POST(
      makeRequest({ senderId: "u1:thread:1", events: [], controls: [] })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 with missing or invalid rasaUrl", async () => {
    const res = await POST(
      makeRequest(
        { senderId: "u1:thread:1", events: [{ event: "bot", text: "hi" }], controls: [] },
        { rasaUrl: "http://evil.host:9999" }
      )
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
        senderId: "u1:thread:1",
        events: [{ event: "bot", text: "hello", data: {} }],
        controls: [],
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(publishCommittedHistoryItemsMock).toHaveBeenCalledOnce();
  });

  it("publishes controls (lock/release) directly to SSE bus without saving to tracker", async () => {
    fetchRasaTrackerEventsMock.mockResolvedValue({
      events: [],
      error: undefined,
      status: 200,
    });

    const res = await POST(
      makeRequest({
        senderId: "u1:thread:1",
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
        senderId: "u1:thread:1",
        events: [{ event: "bot", text: "hi", data: {} }],
        controls: [],
      })
    );

    expect(res.status).toBe(502);
  });
});
