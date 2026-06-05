import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CALLBACK_TOKEN = process.env.LONG_TASK_CALLBACK_TOKEN ?? "test-callback-token";
process.env.LONG_TASK_CALLBACK_TOKEN = CALLBACK_TOKEN;

const fetchRasaTrackerEventsMock = vi.hoisted(() => vi.fn());
const mapRasaTrackerEventsMock = vi.hoisted(() => vi.fn(() => []));
const publishCommittedHistoryItemsMock = vi.hoisted(() => vi.fn(() => 1));
const publishToSenderMock = vi.hoisted(() => vi.fn());
const setCommittedCursorFloorMock = vi.hoisted(() => vi.fn());
const getRasaBotsMock = vi.hoisted(() => vi.fn());
const withRasaAuthMock = vi.hoisted(() => vi.fn((url: string) => url));

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

import { POST } from "@/app/api/rasa/long-task-callback/route";

beforeEach(() => {
  fetchRasaTrackerEventsMock.mockReset();
  mapRasaTrackerEventsMock.mockReset();
  publishCommittedHistoryItemsMock.mockReset();
  publishToSenderMock.mockReset();
  setCommittedCursorFloorMock.mockReset();
  getRasaBotsMock.mockReset();
  withRasaAuthMock.mockReset();

  publishCommittedHistoryItemsMock.mockReturnValue(1);
  withRasaAuthMock.mockImplementation((url: string) => url);
  getRasaBotsMock.mockReturnValue([{ lang: "en", url: "http://rasa.test" }]);

  global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as never;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/rasa/long-task-callback", () => {
  it("returns 502 and does not publish when baseline tracker read fails", async () => {
    fetchRasaTrackerEventsMock.mockResolvedValue({
      events: [],
      error: "tracker unavailable",
      status: 502,
    });

    const request = new NextRequest(
      "http://localhost/api/rasa/long-task-callback?rasaUrl=http%3A%2F%2Frasa.test&senderId=sender-1",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-long-task-callback-token": CALLBACK_TOKEN,
        },
        body: JSON.stringify({
          senderId: "sender-1",
          events: [{ event: "bot", text: "done" }],
        }),
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(502);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(publishCommittedHistoryItemsMock).not.toHaveBeenCalled();
    expect(publishToSenderMock).not.toHaveBeenCalled();
  });

  it("persists tracker events before publishing committed canonical items", async () => {
    fetchRasaTrackerEventsMock
      .mockResolvedValueOnce({
        events: [{ event: "user" }, { event: "bot" }],
        error: undefined,
        status: 200,
      })
      .mockResolvedValueOnce({
        events: [{ event: "user" }, { event: "bot" }, { event: "bot" }],
        error: undefined,
        status: 200,
      });

    mapRasaTrackerEventsMock.mockReturnValue([
      { role: "assistant", text: "done", debug: { eventIndex: 2, turnIndex: 1 } },
    ]);

    const request = new NextRequest(
      "http://localhost/api/rasa/long-task-callback?rasaUrl=http%3A%2F%2Frasa.test&senderId=sender-1",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-long-task-callback-token": CALLBACK_TOKEN,
        },
        body: JSON.stringify({
          senderId: "sender-1",
          events: [{ event: "bot", text: "done" }],
        }),
      }
    );

    const response = await POST(request);
    const body = (await response.json()) as { ok: boolean; senderId: string; messages: number; controls: number };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, senderId: "sender-1", messages: 1, controls: 0 });

    expect(setCommittedCursorFloorMock).toHaveBeenCalledWith("sender-1", 1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(publishCommittedHistoryItemsMock).toHaveBeenCalledWith(
      "sender-1",
      expect.any(Array),
      expect.objectContaining({
        minEventIndexExclusive: 1,
        source: "long-task-callback",
      })
    );

    const persistCallOrder = (global.fetch as unknown as { mock: { invocationCallOrder: number[] } }).mock
      .invocationCallOrder[0];
    const publishCallOrder = publishCommittedHistoryItemsMock.mock.invocationCallOrder[0];
    expect(persistCallOrder).toBeLessThan(publishCallOrder);
    expect(publishToSenderMock).not.toHaveBeenCalled();
  });

  it("accepts controls-only payloads and publishes controls without tracker persistence", async () => {
    const request = new NextRequest(
      "http://localhost/api/rasa/long-task-callback?rasaUrl=http%3A%2F%2Frasa.test&senderId=sender-1",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-long-task-callback-token": CALLBACK_TOKEN,
        },
        body: JSON.stringify({
          senderId: "sender-1",
          controls: [{ type: "lock", jobId: "job-1" }],
        }),
      }
    );

    const response = await POST(request);
    const body = (await response.json()) as { ok: boolean; senderId: string; messages: number; controls: number };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, senderId: "sender-1", messages: 0, controls: 1 });
    expect(fetchRasaTrackerEventsMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(publishCommittedHistoryItemsMock).not.toHaveBeenCalled();
    expect(publishToSenderMock).toHaveBeenCalledTimes(1);
    expect(publishToSenderMock).toHaveBeenCalledWith(
      "sender-1",
      expect.objectContaining({ type: "lock", jobId: "job-1" })
    );
  });
});
