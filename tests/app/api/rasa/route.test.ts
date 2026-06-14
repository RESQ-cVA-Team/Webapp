import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getRasaUrlForRequestMock = vi.hoisted(() => vi.fn());
const withRasaAuthMock = vi.hoisted(() => vi.fn((url: string) => url));
const putUserAccessTokenMock = vi.hoisted(() => vi.fn());
const buildRasaSenderIdMock = vi.hoisted(() => vi.fn(() => "sender-1"));
const setCommittedCursorFloorMock = vi.hoisted(() => vi.fn());
const publishCommittedHistoryItemsMock = vi.hoisted(() => vi.fn(() => 2));
const fetchRasaTrackerEventsMock = vi.hoisted(() => vi.fn());
const mapRasaTrackerEventsMock = vi.hoisted(() => vi.fn(() => []));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/rasaConfig", () => ({
  getRasaUrlForRequest: getRasaUrlForRequestMock,
  withRasaAuth: withRasaAuthMock,
}));

vi.mock("@/lib/userTokenVault", () => ({
  putUserAccessToken: putUserAccessTokenMock,
}));

vi.mock("@/lib/rasaSender", () => ({
  buildRasaSenderId: buildRasaSenderIdMock,
}));

vi.mock("@/lib/sseBus", () => ({
  setCommittedCursorFloor: setCommittedCursorFloorMock,
  publishCommittedHistoryItems: publishCommittedHistoryItemsMock,
}));

vi.mock("@/lib/rasaHistory", () => ({
  fetchRasaTrackerEvents: fetchRasaTrackerEventsMock,
  mapRasaTrackerEvents: mapRasaTrackerEventsMock,
}));

import { POST } from "@/app/api/rasa/route";

beforeEach(() => {
  authMock.mockReset();
  getRasaUrlForRequestMock.mockReset();
  withRasaAuthMock.mockReset();
  putUserAccessTokenMock.mockReset();
  buildRasaSenderIdMock.mockReset();
  setCommittedCursorFloorMock.mockReset();
  publishCommittedHistoryItemsMock.mockReset();
  fetchRasaTrackerEventsMock.mockReset();
  mapRasaTrackerEventsMock.mockReset();

  withRasaAuthMock.mockImplementation((url: string) => url);
  buildRasaSenderIdMock.mockReturnValue("sender-1");
  publishCommittedHistoryItemsMock.mockReturnValue(2);

  authMock.mockResolvedValue({
    accessToken: "token-1",
    accessTokenExpires: Date.now() + 10_000,
    user: { id: "user-1" },
  });
  getRasaUrlForRequestMock.mockReturnValue("http://rasa.test");

  global.fetch = vi.fn(async () => new Response("[]\n", { status: 200 })) as never;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/rasa", () => {
  it("returns 502 when baseline tracker fetch fails", async () => {
    fetchRasaTrackerEventsMock.mockResolvedValue({
      events: [],
      error: "tracker unavailable",
      status: 502,
    });

    const request = new NextRequest("http://localhost/api/rasa", {
      method: "POST",
      body: JSON.stringify({ message: "hello", threadId: 5 }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(502);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(publishCommittedHistoryItemsMock).not.toHaveBeenCalled();
  });

  it("publishes only committed tracker items after upstream completes", async () => {
    fetchRasaTrackerEventsMock
      .mockResolvedValueOnce({
        events: [{ event: "user" }, { event: "bot" }],
        error: undefined,
        status: 200,
      })
      .mockResolvedValueOnce({
        events: [{ event: "user" }, { event: "bot" }, { event: "bot" }, { event: "bot" }],
        error: undefined,
        status: 200,
      });

    mapRasaTrackerEventsMock.mockReturnValue([
      { role: "assistant", text: "A", debug: { eventIndex: 2, turnIndex: 1 } },
      { role: "assistant", text: "B", debug: { eventIndex: 3, turnIndex: 1 } },
    ]);

    const request = new NextRequest("http://localhost/api/rasa", {
      method: "POST",
      body: JSON.stringify({ message: "hello", threadId: 5 }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok: boolean; senderId: string; publishedMessages: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.senderId).toBe("sender-1");
    expect(body.publishedMessages).toBe(2);

    expect(setCommittedCursorFloorMock).toHaveBeenCalledWith("sender-1", 1);
    expect(mapRasaTrackerEventsMock).toHaveBeenCalledWith(
      [{ event: "user" }, { event: "bot" }, { event: "bot" }, { event: "bot" }],
      true
    );
    expect(publishCommittedHistoryItemsMock).toHaveBeenCalledWith(
      "sender-1",
      expect.any(Array),
      expect.objectContaining({
        minEventIndexExclusive: 1,
        source: "rasa-webhook",
      })
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("forwards ui display text as metadata on the same webhook message", async () => {
    fetchRasaTrackerEventsMock
      .mockResolvedValueOnce({
        events: [{ event: "user" }],
        error: undefined,
        status: 200,
      })
      .mockResolvedValueOnce({
        events: [{ event: "user" }, { event: "bot" }],
        error: undefined,
        status: 200,
      });

    mapRasaTrackerEventsMock.mockReturnValue([
      { role: "assistant", text: "ok", debug: { eventIndex: 1, turnIndex: 1 } },
    ]);

    const request = new NextRequest("http://localhost/api/rasa", {
      method: "POST",
      body: JSON.stringify({
        message: "/request_guided_visualization",
        uiDisplayText: "Guided mode",
        threadId: 5,
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const fetchArgs = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const fetchInit = fetchArgs[1] as { body?: string };
    const payload = JSON.parse(fetchInit.body ?? "{}");

    expect(payload.sender).toBe("sender-1");
    expect(payload.message).toBe("/request_guided_visualization");
    expect(payload.metadata.ui_display_text).toBe("Guided mode");
  });
});
