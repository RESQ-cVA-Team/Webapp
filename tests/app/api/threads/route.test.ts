import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const listThreadsForUserMock = vi.hoisted(() => vi.fn());
const createThreadForUserMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/threadRegistryStore", () => ({
  createThreadForUser: createThreadForUserMock,
  listThreadsForUser: listThreadsForUserMock,
}));

import { GET, POST } from "@/app/api/threads/route";

beforeEach(() => {
  authMock.mockReset();
  listThreadsForUserMock.mockReset();
  createThreadForUserMock.mockReset();
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
    createThreadForUserMock.mockResolvedValue({ id: 2, name: "My thread" });

    const request = new NextRequest("http://localhost/api/threads", {
      method: "POST",
      body: JSON.stringify({ name: "My thread" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 2, name: "My thread" });
    expect(createThreadForUserMock).toHaveBeenCalledWith("user-1", "My thread");
  });
});