import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getRasaUrlForRequestMock = vi.hoisted(() => vi.fn());
const withRasaAuthMock = vi.hoisted(() => vi.fn((url: string) => url));
const buildRasaSenderIdMock = vi.hoisted(() => vi.fn());
const cookiesMock = vi.hoisted(() => vi.fn());
const headersMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/rasaConfig", () => ({
  getRasaUrlForRequest: getRasaUrlForRequestMock,
  withRasaAuth: withRasaAuthMock,
}));

vi.mock("@/lib/rasaSender", () => ({
  buildRasaSenderId: buildRasaSenderIdMock,
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
  headers: headersMock,
}));

import { DELETE, PATCH } from "@/app/api/threads/[id]/route";

beforeEach(() => {
  authMock.mockReset();
  getRasaUrlForRequestMock.mockReset();
  withRasaAuthMock.mockReset();
  withRasaAuthMock.mockImplementation((url: string) => url);
  buildRasaSenderIdMock.mockReset();
  cookiesMock.mockReset();
  headersMock.mockReset();
  global.fetch = vi.fn(async () => new Response(null, { status: 200 })) as never;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PATCH /api/threads/[id]", () => {
  it("returns unauthorized without a session user id", async () => {
    authMock.mockResolvedValue(null);

    const response = await PATCH(
      new NextRequest("http://localhost/api/threads/1", { method: "PATCH" }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(401);
  });

  it("rejects invalid thread ids", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });

    const response = await PATCH(
      new NextRequest("http://localhost/api/threads/not-a-number", { method: "PATCH" }),
      { params: Promise.resolve({ id: "not-a-number" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Invalid thread id" });
  });

  it("renames the thread for the authenticated user", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    cookiesMock.mockResolvedValue({ getAll: () => [] });
    headersMock.mockResolvedValue(new Headers());
    getRasaUrlForRequestMock.mockReturnValue("https://rasa.example.com");
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threads: [{ id: 1, name: "Thread", created_at: "2026-06-03T00:00:00.000Z", updated_at: "2026-06-03T00:00:00.000Z" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threads: [{ id: 1, name: "Renamed thread", created_at: "2026-06-03T00:00:00.000Z", updated_at: "2026-06-04T00:00:00.000Z" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      ) as never;

    const response = await PATCH(
      new NextRequest("http://localhost/api/threads/1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed thread" }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 1,
      name: "Renamed thread",
      created_at: "2026-06-03T00:00:00.000Z",
      updated_at: "2026-06-04T00:00:00.000Z",
    });
  });
});

describe("DELETE /api/threads/[id]", () => {
  it("returns unauthorized without a session user id", async () => {
    authMock.mockResolvedValue({ user: {} });

    const response = await DELETE(
      new NextRequest("http://localhost/api/threads/1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(401);
  });

  it("returns not found when the thread does not exist", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    cookiesMock.mockResolvedValue({ getAll: () => [] });
    headersMock.mockResolvedValue(new Headers());
    getRasaUrlForRequestMock.mockReturnValue("https://rasa.example.com");
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ threads: [] }), { status: 200, headers: { "content-type": "application/json" } })
    ) as never;

    const response = await DELETE(
      new NextRequest("http://localhost/api/threads/1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Thread not found" });
  });

  it("resets the Rasa tracker after deleting a thread", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    cookiesMock.mockResolvedValue({ getAll: () => [] });
    headersMock.mockResolvedValue(new Headers());
    getRasaUrlForRequestMock.mockReturnValue("https://rasa.example.com");
    buildRasaSenderIdMock.mockReturnValue("sender-1");
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threads: [{ id: 1, name: "Thread", created_at: "2026-06-03T00:00:00.000Z", updated_at: "2026-06-03T00:00:00.000Z" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 })) as never;

    const response = await DELETE(
      new NextRequest("http://localhost/api/threads/1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: 1 });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://rasa.example.com/conversations/sender-1/tracker/events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ event: "restart" }),
      })
    );
  });
});