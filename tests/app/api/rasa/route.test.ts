import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- hoisted mocks ---
const authMock = vi.hoisted(() => vi.fn());
const fetchRasaTrackerEventsMock = vi.hoisted(() => vi.fn());
const mapRasaTrackerEventsMock = vi.hoisted(() => vi.fn());
const publishCommittedHistoryItemsMock = vi.hoisted(() => vi.fn());
const setCommittedCursorFloorMock = vi.hoisted(() => vi.fn());
const putUserAccessTokenMock = vi.hoisted(() => vi.fn());
const getRasaUrlForRequestMock = vi.hoisted(() => vi.fn());
const withRasaAuthMock = vi.hoisted(() => vi.fn((url: string) => url));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/rasaHistory", () => ({
  fetchRasaTrackerEvents: fetchRasaTrackerEventsMock,
  mapRasaTrackerEvents: mapRasaTrackerEventsMock,
}));
vi.mock("@/lib/sseBus", () => ({
  publishCommittedHistoryItems: publishCommittedHistoryItemsMock,
  setCommittedCursorFloor: setCommittedCursorFloorMock,
}));
vi.mock("@/lib/userTokenVault", () => ({ putUserAccessToken: putUserAccessTokenMock }));
vi.mock("@/lib/rasaConfig", () => ({
  getRasaUrlForRequest: getRasaUrlForRequestMock,
  withRasaAuth: withRasaAuthMock,
}));
vi.mock("@/lib/rasaSender", () => ({
  buildRasaSenderId: (userSub: string, threadId: number | null) =>
    threadId != null ? `${userSub}:thread:${threadId}` : userSub,
}));
vi.mock("@/lib/traceId", () => ({
  readTraceId: () => null,
  withTraceIdHeaders: () => ({}),
  createTraceLogContext: (_: unknown, extra?: unknown) => extra ?? {},
  createTraceErrorResponse: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}));

vi.stubGlobal("fetch", fetchMock);

import { POST } from "@/app/api/rasa/route";

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/rasa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authMock.mockReset();
  fetchRasaTrackerEventsMock.mockReset();
  mapRasaTrackerEventsMock.mockReset();
  publishCommittedHistoryItemsMock.mockReset();
  setCommittedCursorFloorMock.mockReset();
  getRasaUrlForRequestMock.mockReset();
  fetchMock.mockReset();
  withRasaAuthMock.mockImplementation((url: string) => url);
  publishCommittedHistoryItemsMock.mockReturnValue(0);
  mapRasaTrackerEventsMock.mockReturnValue([]);
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/rasa", () => {
  it("returns 401 when no session", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(makeRequest({ message: "hello", threadId: 1 }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when session has no accessToken", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(makeRequest({ message: "hello", threadId: 1 }));
    expect(res.status).toBe(401);
  });

  it("returns 500 when Rasa URL is not configured", async () => {
    authMock.mockResolvedValue({ accessToken: "tok", user: { id: "u1" } });
    getRasaUrlForRequestMock.mockReturnValue(null);
    const res = await POST(makeRequest({ message: "hello", threadId: 1 }));
    expect(res.status).toBe(500);
  });

  it("returns 502 when baseline tracker fetch fails", async () => {
    authMock.mockResolvedValue({ accessToken: "tok", user: { id: "u1" } });
    getRasaUrlForRequestMock.mockReturnValue("http://rasa:5005");
    fetchRasaTrackerEventsMock.mockResolvedValue({ events: [], error: "Rasa down", status: 503 });

    const res = await POST(makeRequest({ message: "hello", threadId: 1 }));
    expect(res.status).toBe(502);
  });

  it("returns ok with publishedMessages on success", async () => {
    authMock.mockResolvedValue({ accessToken: "tok", user: { id: "u1" }, accessTokenExpires: 9999999 });
    getRasaUrlForRequestMock.mockReturnValue("http://rasa:5005");

    // baseline tracker
    fetchRasaTrackerEventsMock
      .mockResolvedValueOnce({ events: [{ event: "session_started" }], error: undefined, status: 200 })
      // committed tracker after response
      .mockResolvedValueOnce({ events: [{ event: "session_started" }, { event: "user", text: "hello" }, { event: "bot", text: "hi" }], error: undefined, status: 200 });

    mapRasaTrackerEventsMock.mockReturnValue([
      { role: "user", text: "hello", debug: { eventIndex: 1, turnIndex: 1 } },
      { role: "assistant", text: "hi", feedbackKey: "bot:2", debug: { eventIndex: 2, turnIndex: 1 } },
    ]);
    publishCommittedHistoryItemsMock.mockReturnValue(2);

    // Mock Rasa upstream returning a streamable response
    const bodyStream = new ReadableStream({ start(c) { c.close(); } });
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: bodyStream });

    const res = await POST(makeRequest({ message: "hello", threadId: 1 }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.publishedMessages).toBe("number");
  });

  it("seeds the cursor floor from the baseline tracker event count", async () => {
    authMock.mockResolvedValue({ accessToken: "tok", user: { id: "u1" } });
    getRasaUrlForRequestMock.mockReturnValue("http://rasa:5005");

    const baselineEvents = [{ event: "session_started" }, { event: "user", text: "prev" }];
    fetchRasaTrackerEventsMock
      .mockResolvedValueOnce({ events: baselineEvents, error: undefined, status: 200 })
      .mockResolvedValueOnce({ events: baselineEvents, error: undefined, status: 200 });

    mapRasaTrackerEventsMock.mockReturnValue([]);
    publishCommittedHistoryItemsMock.mockReturnValue(0);

    const bodyStream = new ReadableStream({ start(c) { c.close(); } });
    fetchMock.mockResolvedValue({ ok: true, status: 200, body: bodyStream });

    await POST(makeRequest({ message: "hi", threadId: 1 }));

    // baseline has 2 events → cursor floor should be set to index 1 (length - 1)
    expect(setCommittedCursorFloorMock).toHaveBeenCalledWith(
      expect.any(String),
      baselineEvents.length - 1
    );
  });
});
