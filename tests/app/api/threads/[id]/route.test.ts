import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getThreadFromRasaMock = vi.hoisted(() => vi.fn());
const renameThreadInRasaMock = vi.hoisted(() => vi.fn());
const deleteThreadInRasaMock = vi.hoisted(() => vi.fn());
const getRasaUrlForRequestMock = vi.hoisted(() => vi.fn());
const withRasaAuthMock = vi.hoisted(() => vi.fn((url: string) => url));
const buildRasaSenderIdMock = vi.hoisted(() => vi.fn());
const cookiesMock = vi.hoisted(() => vi.fn());
const headersMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/rasaThreadIndex", () => ({
  deleteThreadInRasa: deleteThreadInRasaMock,
  getThreadFromRasa: getThreadFromRasaMock,
  renameThreadInRasa: renameThreadInRasaMock,
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
  getThreadFromRasaMock.mockReset();
  renameThreadInRasaMock.mockReset();
  deleteThreadInRasaMock.mockReset();
  getRasaUrlForRequestMock.mockReset();
  withRasaAuthMock.mockReset();
  withRasaAuthMock.mockImplementation((url: string) => url);
  buildRasaSenderIdMock.mockReset();
  cookiesMock.mockReset();
  headersMock.mockReset();
  // Default: provide working cookies/headers mocks for all tests.
  cookiesMock.mockResolvedValue({ getAll: () => [] });
  headersMock.mockResolvedValue(new Headers());
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
    renameThreadInRasaMock.mockResolvedValue({ id: 1, name: "Renamed thread" });

    const response = await PATCH(
      new NextRequest("http://localhost/api/threads/1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed thread" }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 1, name: "Renamed thread" });
    expect(renameThreadInRasaMock).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      cookies: expect.any(Map),
      userId: "user-1",
      threadId: 1,
      name: "Renamed thread",
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

  it("returns not found when deleteThreadInRasa returns false", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    // deleteThreadInRasa calls the Rasa DELETE endpoint; if Rasa returns 404
    // it returns false, which this mock simulates.
    deleteThreadInRasaMock.mockResolvedValue(false);

    const response = await DELETE(
      new NextRequest("http://localhost/api/threads/1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Thread not found" });
  });

  it("returns ok when thread is successfully deleted", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    deleteThreadInRasaMock.mockResolvedValue(true);

    const response = await DELETE(
      new NextRequest("http://localhost/api/threads/1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: 1 });
    expect(deleteThreadInRasaMock).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      cookies: expect.any(Map),
      userId: "user-1",
      threadId: 1,
    });
  });
});