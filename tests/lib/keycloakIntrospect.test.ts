import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  process.env.KEYCLOAK_ISSUER = "https://keycloak.test/realms/stroke";
  process.env.KEYCLOAK_CLIENT_ID = "cva";
  process.env.KEYCLOAK_CLIENT_SECRET = "cva-secret";
  process.env.ACTION_CLIENT_ID = "action-server-service";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("introspectToken", () => {
  it("returns null when Keycloak env vars are unset", async () => {
    delete process.env.KEYCLOAK_ISSUER;
    const { introspectToken } = await import("@/lib/keycloakIntrospect");
    expect(await introspectToken("tok")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the payload when the token is active", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ active: true, sub: "u1", azp: "action-server-service" }), { status: 200 })
    );
    const { introspectToken } = await import("@/lib/keycloakIntrospect");
    const result = await introspectToken("tok");
    expect(result).toEqual({ active: true, sub: "u1", azp: "action-server-service" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://keycloak.test/realms/stroke/protocol/openid-connect/token/introspect");
    expect(init.method).toBe("POST");
  });

  it("returns null when the token is inactive", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ active: false }), { status: 200 }));
    const { introspectToken } = await import("@/lib/keycloakIntrospect");
    expect(await introspectToken("tok")).toBeNull();
  });

  it("returns null on a non-ok response or network failure, never throws", async () => {
    fetchMock.mockResolvedValueOnce(new Response("error", { status: 500 }));
    const { introspectToken } = await import("@/lib/keycloakIntrospect");
    expect(await introspectToken("tok")).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(introspectToken("tok")).resolves.toBeNull();
  });
});

describe("verifyActionServiceBearer", () => {
  it("returns false when there's no Authorization header", async () => {
    const { verifyActionServiceBearer } = await import("@/lib/keycloakIntrospect");
    expect(await verifyActionServiceBearer(null)).toBe(false);
    expect(await verifyActionServiceBearer("Basic abc")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false when ACTION_CLIENT_ID isn't configured", async () => {
    delete process.env.ACTION_CLIENT_ID;
    const { verifyActionServiceBearer } = await import("@/lib/keycloakIntrospect");
    expect(await verifyActionServiceBearer("Bearer tok")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns true when the introspected token's azp matches the expected client id", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ active: true, azp: "action-server-service" }), { status: 200 })
    );
    const { verifyActionServiceBearer } = await import("@/lib/keycloakIntrospect");
    expect(await verifyActionServiceBearer("Bearer tok")).toBe(true);
  });

  it("falls back to the client_id claim when azp is absent", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ active: true, client_id: "action-server-service" }), { status: 200 })
    );
    const { verifyActionServiceBearer } = await import("@/lib/keycloakIntrospect");
    expect(await verifyActionServiceBearer("Bearer tok")).toBe(true);
  });

  it("returns false when the token belongs to a different client", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ active: true, azp: "some-other-client" }), { status: 200 })
    );
    const { verifyActionServiceBearer } = await import("@/lib/keycloakIntrospect");
    expect(await verifyActionServiceBearer("Bearer tok")).toBe(false);
  });

  it("returns false when the token is inactive/invalid", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ active: false }), { status: 200 }));
    const { verifyActionServiceBearer } = await import("@/lib/keycloakIntrospect");
    expect(await verifyActionServiceBearer("Bearer tok")).toBe(false);
  });
});
