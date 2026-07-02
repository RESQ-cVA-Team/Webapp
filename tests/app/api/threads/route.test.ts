import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const listThreadsFromRasaMock = vi.hoisted(() => vi.fn());
const createThreadInRasaMock = vi.hoisted(() => vi.fn());
const headersMock = vi.hoisted(() => vi.fn());
const cookiesMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/rasaThreadIndex", () => ({
  createThreadInRasa: createThreadInRasaMock,
  listThreadsFromRasa: listThreadsFromRasaMock,
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
  cookies: cookiesMock,
}));

import { GET, POST } from "@/app/api/threads/route";

beforeEach(() => {
  authMock.mockReset();
  listThreadsFromRasaMock.mockReset();
  createThreadInRasaMock.mockReset();
  headersMock.mockReset();
  cookiesMock.mockReset();
  headersMock.mockResolvedValue(new Headers());
  cookiesMock.mockResolvedValue({ getAll: () => [] });
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
    listThreadsFromRasaMock.mockResolvedValue([{ id: 1, name: "First thread" }]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [{ id: 1, name: "First thread" }] });
    expect(listThreadsFromRasaMock).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      cookies: expect.any(Map),
      userId: "user-1",
    });
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
    createThreadInRasaMock.mockResolvedValue({ id: 2, name: "My thread" });

    const request = new NextRequest("http://localhost/api/threads", {
      method: "POST",
      body: JSON.stringify({ name: "My thread" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 2, name: "My thread" });
    expect(createThreadInRasaMock).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      cookies: expect.any(Map),
      userId: "user-1",
      name: "My thread",
    });
  });
});