import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserAccessTokenMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const getJobMock = vi.hoisted(() => vi.fn());
const touchJobMock = vi.hoisted(() => vi.fn());
const verifyActionServiceBearerMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/userTokenVault", () => ({
  getUserAccessToken: getUserAccessTokenMock,
}));

vi.mock("@/lib/jobStore", () => ({
  getJob: getJobMock,
  touchJob: touchJobMock,
}));

vi.mock("@/lib/keycloakIntrospect", () => ({
  verifyActionServiceBearer: verifyActionServiceBearerMock,
}));

vi.mock("@/lib/traceId", () => ({
  TRACE_ID_HEADER: "x-trace-id",
  readTraceId: () => "trace-test",
  withTraceIdHeaders: (headers?: HeadersInit) => new Headers(headers),
  createTraceLogContext: (_: unknown, extra?: unknown) => extra ?? {},
}));

vi.stubGlobal("fetch", fetchMock);

function makeRequest(body: Record<string, unknown>, token = "svc-token") {
  return new NextRequest("http://localhost/api/rasa-proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/rasa-proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    getUserAccessTokenMock.mockReset();
    fetchMock.mockReset();
    getJobMock.mockReset();
    touchJobMock.mockReset();
    verifyActionServiceBearerMock.mockReset();
    verifyActionServiceBearerMock.mockResolvedValue(true);
    process.env.RASA_PROXY_TARGETS = JSON.stringify({ graphql: "http://upstream.test" });
  });

  it("returns 401 when the caller's service credentials don't verify", async () => {
    verifyActionServiceBearerMock.mockResolvedValue(false);

    const { POST } = await import("@/app/api/rasa-proxy/route");
    const res = await POST(makeRequest({ jobId: "job-1", target: "graphql", request: { path: "/x" } }));

    expect(res.status).toBe(401);
  });

  it("resolves identity via jobId, looking up the token by the job's principal sub", async () => {
    getJobMock.mockResolvedValue({ sub: "u1", threadId: 12, rasaUrl: "http://rasa:5005", createdAt: 0, expiresAt: 0 });
    getUserAccessTokenMock.mockReturnValue("user-access-token");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { POST } = await import("@/app/api/rasa-proxy/route");
    const res = await POST(
      makeRequest({
        jobId: "job-1",
        target: "graphql",
        request: { path: "/api/graphql/aggregation", method: "POST", body: { query: "{}" } },
      })
    );

    expect(getJobMock).toHaveBeenCalledWith("job-1");
    expect(touchJobMock).toHaveBeenCalledWith("job-1");
    expect(getUserAccessTokenMock).toHaveBeenCalledWith("u1");
    expect(res.status).toBe(200);
  });

  it("returns 403 when the requested path isn't allow-listed for the target", async () => {
    getJobMock.mockResolvedValue({ sub: "u1", threadId: null, rasaUrl: "http://rasa:5005", createdAt: 0, expiresAt: 0 });
    getUserAccessTokenMock.mockReturnValue("user-access-token");

    const { POST } = await import("@/app/api/rasa-proxy/route");
    const res = await POST(
      makeRequest({
        jobId: "job-1",
        target: "graphql",
        request: { path: "/api/rest/analytics-center/providers", method: "POST", body: {} },
      })
    );

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 for an unknown target even with no path restriction configured for it", async () => {
    getJobMock.mockResolvedValue({ sub: "u1", threadId: null, rasaUrl: "http://rasa:5005", createdAt: 0, expiresAt: 0 });
    getUserAccessTokenMock.mockReturnValue("user-access-token");
    process.env.RASA_PROXY_TARGETS = JSON.stringify({ graphql: "http://upstream.test", other: "http://other.test" });

    const { POST } = await import("@/app/api/rasa-proxy/route");
    const res = await POST(
      makeRequest({
        jobId: "job-1",
        target: "other",
        request: { path: "/anything", method: "POST", body: {} },
      })
    );

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 when jobId doesn't resolve to a known job", async () => {
    getJobMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/rasa-proxy/route");
    const res = await POST(
      makeRequest({
        jobId: "stale-or-forged",
        target: "graphql",
        request: { path: "/api/graphql/aggregation", method: "POST", body: {} },
      })
    );

    expect(res.status).toBe(401);
    expect(getUserAccessTokenMock).not.toHaveBeenCalled();
  });

  it("returns 400 when jobId is missing entirely", async () => {
    const { POST } = await import("@/app/api/rasa-proxy/route");
    const res = await POST(
      makeRequest({
        target: "graphql",
        request: { path: "/api/graphql/aggregation", method: "POST", body: {} },
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe("Invalid proxy request");
    expect(getJobMock).not.toHaveBeenCalled();
  });

  it("returns 401 when principal token is missing", async () => {
    getJobMock.mockResolvedValue({ sub: "u1", threadId: 1, rasaUrl: "http://rasa:5005", createdAt: 0, expiresAt: 0 });
    getUserAccessTokenMock.mockReturnValue(null);

    const { POST } = await import("@/app/api/rasa-proxy/route");
    const res = await POST(
      makeRequest({
        jobId: "job-1",
        target: "graphql",
        request: { path: "/api/graphql/aggregation", method: "POST", body: {} },
      })
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toBe("User token unavailable");
    expect(body.proxy.principalUserSub).toBe("u1");
  });
});
