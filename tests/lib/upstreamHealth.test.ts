import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeLiveness, resetUpstreamHealthCache, sharedUpstreamHealth, UPSTREAM_HEALTH_TTL_MS } from "@/lib/upstreamHealth";

const target = { key: "upstream_graphql", label: "Upstream aggregation", url: "https://graphql.example.com/api/rest/aggregation/health/live" };

function respondWith(body: unknown, status = 200) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as never;
}

beforeEach(() => resetUpstreamHealthCache());
afterEach(() => vi.restoreAllMocks());

describe("sharedUpstreamHealth", () => {
  it("shares one probe between callers until the results are stale", async () => {
    const probe = vi.fn(async () => []);
    await Promise.all([sharedUpstreamHealth(probe, 1_000), sharedUpstreamHealth(probe, 1_000)]);
    await sharedUpstreamHealth(probe, 1_000 + UPSTREAM_HEALTH_TTL_MS - 1);
    expect(probe).toHaveBeenCalledTimes(1);
    await sharedUpstreamHealth(probe, 1_000 + UPSTREAM_HEALTH_TTL_MS);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe("probeLiveness", () => {
  it("is up when the service reports UP, with its commit", async () => {
    respondWith({ status: "UP", meta: { commit: "c92127b74076fde4" } });
    const item = await probeLiveness(target);
    expect(item.status).toBe("up");
    expect(item.detail).toBe("Live (commit c92127b)");
  });

  it("is down when the service reports anything else", async () => {
    respondWith({ status: "DOWN" });
    expect((await probeLiveness(target)).status).toBe("down");
  });

  it("classifies an error response by its status", async () => {
    respondWith({}, 503);
    const item = await probeLiveness(target);
    expect(item.status).toBe("down");
    expect(item.httpStatus).toBe(503);
  });

  it("is down when the request fails", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as never;
    const item = await probeLiveness(target);
    expect(item.status).toBe("down");
    expect(item.detail).toContain("ECONNREFUSED");
  });

  it("is misconfigured without a URL", async () => {
    expect((await probeLiveness({ ...target, url: null })).status).toBe("misconfigured");
  });
});
