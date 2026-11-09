import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getTokenMock = vi.hoisted(() => vi.fn());
const getUserTokenEntryMock = vi.hoisted(() => vi.fn());

vi.mock("next-auth/jwt", () => ({ getToken: getTokenMock }));
vi.mock("@/lib/userTokenVault", () => ({ getUserTokenEntry: getUserTokenEntryMock }));
vi.mock("@/auth.config", () => ({ keycloakIssuer: "https://keycloak.test/realms/stroke" }));

function makeRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/auth/keycloak-logout-url${query}`);
}

beforeEach(() => {
  getTokenMock.mockReset();
  getUserTokenEntryMock.mockReset();
  process.env.KEYCLOAK_CLIENT_ID = "cva";
  process.env.NEXTAUTH_SECRET = "test-secret";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/auth/keycloak-logout-url", () => {
  it("returns a Keycloak end-session URL with the vaulted id_token as hint", async () => {
    getTokenMock.mockResolvedValue({ sub: "user-1" });
    getUserTokenEntryMock.mockResolvedValue({ idToken: "the-id-token" });

    const { GET } = await import("@/app/api/auth/keycloak-logout-url/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(getUserTokenEntryMock).toHaveBeenCalledWith("user-1");
    const url = new URL(body.url);
    expect(url.origin + url.pathname).toBe("https://keycloak.test/realms/stroke/protocol/openid-connect/logout");
    expect(url.searchParams.get("id_token_hint")).toBe("the-id-token");
    expect(url.searchParams.has("client_id")).toBe(false);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("http://localhost:3000/");
  });

  it.each([
    ["no session", null],
    ["a session whose vault entry has expired", { sub: "user-1" }],
  ])("uses client_id instead of a hint for %s", async (_name, token) => {
    getTokenMock.mockResolvedValue(token);
    getUserTokenEntryMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/auth/keycloak-logout-url/route");
    const res = await GET(makeRequest());
    const body = await res.json();

    const url = new URL(body.url);
    expect(url.searchParams.get("client_id")).toBe("cva");
    expect(url.searchParams.has("id_token_hint")).toBe(false);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("http://localhost:3000/");
  });

  it("returns null with neither an id_token nor a client id", async () => {
    getTokenMock.mockResolvedValue(null);
    delete process.env.KEYCLOAK_CLIENT_ID;

    const { GET } = await import("@/app/api/auth/keycloak-logout-url/route");
    const res = await GET(makeRequest());

    expect((await res.json()).url).toBeNull();
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
