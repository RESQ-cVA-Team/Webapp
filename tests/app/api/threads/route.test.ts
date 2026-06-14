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

import { GET, POST } from "@/app/api/threads/route";

beforeEach(() => {
  authMock.mockReset();
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
    cookiesMock.mockResolvedValue({ getAll: () => [] });
    headersMock.mockResolvedValue(new Headers());
    getRasaUrlForRequestMock.mockReturnValue("https://rasa.example.com");
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          threads: [{ id: 1, name: "First thread", created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-06-01T00:00:00.000Z" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as never;

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [{ id: 1, name: "First thread", created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-06-01T00:00:00.000Z" }],
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
    cookiesMock.mockResolvedValue({ getAll: () => [] });
    headersMock.mockResolvedValue(new Headers());
    getRasaUrlForRequestMock.mockReturnValue("https://rasa.example.com");
    buildRasaSenderIdMock.mockReturnValue("user-1:thread:2");
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threads: [{ id: 1, name: "First thread", created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-06-01T00:00:00.000Z" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threads: [
              { id: 1, name: "First thread", created_at: "2026-06-01T00:00:00.000Z", updated_at: "2026-06-01T00:00:00.000Z" },
              { id: 2, name: "My thread", created_at: "2026-06-02T00:00:00.000Z", updated_at: "2026-06-02T00:00:00.000Z" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      ) as never;

    const request = new NextRequest("http://localhost/api/threads", {
      method: "POST",
      body: JSON.stringify({ name: "My thread" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: 2,
      name: "My thread",
      created_at: "2026-06-02T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
    });
  });
});