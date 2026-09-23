import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getTokenMock = vi.hoisted(() => vi.fn());

vi.mock("next-auth/jwt", () => ({ getToken: getTokenMock }));
vi.mock("@/auth.config", () => ({ keycloakIssuer: "https://keycloak.test/realms/stroke" }));

function makeRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/auth/keycloak-logout-url${query}`);
}

beforeEach(() => {
  getTokenMock.mockReset();
  process.env.NEXTAUTH_SECRET = "test-secret";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/auth/keycloak-logout-url", () => {
  it("returns a Keycloak end-session URL with id_token_hint when a session has an idToken", async () => {
    getTokenMock.mockResolvedValue({ idToken: "the-id-token" });

    const { GET } = await import("@/app/api/auth/keycloak-logout-url/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.url).not.toBeNull();
    const url = new URL(body.url);
    expect(url.origin + url.pathname).toBe("https://keycloak.test/realms/stroke/protocol/openid-connect/logout");
    expect(url.searchParams.get("id_token_hint")).toBe("the-id-token");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("http://localhost:3000/");
  });

  it("returns null when there's no session/idToken", async () => {
    getTokenMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/auth/keycloak-logout-url/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.url).toBeNull();
  });

  it("uses client_id instead of a hint for a user with no session when the caller opts in", async () => {
    getTokenMock.mockResolvedValue(null);
    process.env.KEYCLOAK_CLIENT_ID = "cva";

    const { GET } = await import("@/app/api/auth/keycloak-logout-url/route");
    const res = await GET(makeRequest("?allowClientIdHint=1"));
    const body = await res.json();

    const url = new URL(body.url);
    expect(url.searchParams.get("client_id")).toBe("cva");
    expect(url.searchParams.has("id_token_hint")).toBe(false);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("http://localhost:3000/");
  });

  it("does not fall back to client_id unless the caller opts in", async () => {
    getTokenMock.mockResolvedValue(null);
    process.env.KEYCLOAK_CLIENT_ID = "cva";

    const { GET } = await import("@/app/api/auth/keycloak-logout-url/route");
    const res = await GET(makeRequest());

    expect((await res.json()).url).toBeNull();
  });

  it("prefers the id_token hint over client_id when a session has one", async () => {
    getTokenMock.mockResolvedValue({ idToken: "the-id-token" });
    process.env.KEYCLOAK_CLIENT_ID = "cva";

    const { GET } = await import("@/app/api/auth/keycloak-logout-url/route");
    const res = await GET(makeRequest("?allowClientIdHint=1"));

    const url = new URL((await res.json()).url);
    expect(url.searchParams.get("id_token_hint")).toBe("the-id-token");
    expect(url.searchParams.has("client_id")).toBe(false);
  });

  it("returns null when NEXTAUTH_SECRET is unset, without calling getToken", async () => {
    delete process.env.NEXTAUTH_SECRET;

    const { GET } = await import("@/app/api/auth/keycloak-logout-url/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.url).toBeNull();
    expect(getTokenMock).not.toHaveBeenCalled();
  });
});
