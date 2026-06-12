import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const listThreadsForUserMock = vi.hoisted(() => vi.fn());
const createThreadForUserMock = vi.hoisted(() => vi.fn());
const createThreadForUserWithIdMock = vi.hoisted(() => vi.fn());
const upsertThreadsForUserMock = vi.hoisted(() => vi.fn());
const getRasaUrlForRequestMock = vi.hoisted(() => vi.fn());
const withRasaAuthMock = vi.hoisted(() => vi.fn((url: string) => url));
const buildRasaSenderIdMock = vi.hoisted(() => vi.fn());
const cookiesMock = vi.hoisted(() => vi.fn());
const headersMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/threadRegistryStore", () => ({
  createThreadForUser: createThreadForUserMock,
  createThreadForUserWithId: createThreadForUserWithIdMock,
  listThreadsForUser: listThreadsForUserMock,
  upsertThreadsForUser: upsertThreadsForUserMock,
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

import { GET, POST } from "@/app/api/threads/route";

beforeEach(() => {
  authMock.mockReset();
  listThreadsForUserMock.mockReset();
  createThreadForUserMock.mockReset();
  createThreadForUserWithIdMock.mockReset();
  upsertThreadsForUserMock.mockReset();
  getRasaUrlForRequestMock.mockReset();
  withRasaAuthMock.mockReset();
  withRasaAuthMock.mockImplementation((url: string) => url);
  buildRasaSenderIdMock.mockReset();
  cookiesMock.mockReset();
  headersMock.mockReset();
  delete process.env.RASA_URL_LIST;
  global.fetch = vi.fn(async () => new Response(null, { status: 200 })) as never;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/threads", () => {
  it("returns unauthorized without a session user id", async () => {
    authMock.mockResolvedValue({ user: {} });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });

  it("lists threads for the authenticated user", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    listThreadsForUserMock.mockResolvedValue([{ id: 1, name: "First thread" }]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [{ id: 1, name: "First thread" }] });
    expect(listThreadsForUserMock).toHaveBeenCalledWith("user-1");
  });
});

describe("POST /api/threads", () => {
  it("returns unauthorized without a session user id", async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(new NextRequest("http://localhost/api/threads", { method: "POST" }));

    expect(response.status).toBe(401);
  });

  it("creates a thread with the provided name", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    listThreadsForUserMock.mockResolvedValue([{ id: 1, name: "First thread" }]);
    createThreadForUserWithIdMock.mockResolvedValue({ id: 2, name: "My thread" });
    cookiesMock.mockResolvedValue({ getAll: () => [] });
    headersMock.mockResolvedValue(new Headers());
    getRasaUrlForRequestMock.mockReturnValue(null);

    const request = new NextRequest("http://localhost/api/threads", {
      method: "POST",
      body: JSON.stringify({ name: "My thread" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 2, name: "My thread" });
    expect(createThreadForUserWithIdMock).toHaveBeenCalledWith("user-1", 2, "My thread");
  });
});