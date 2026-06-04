import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getRasaBotsMock = vi.hoisted(() => vi.fn());
const withRasaAuthMock = vi.hoisted(() => vi.fn((url: string) => url));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/rasaConfig", () => ({
  getRasaBots: getRasaBotsMock,
  withRasaAuth: withRasaAuthMock,
}));

import { GET } from "@/app/api/runtime-health/route";

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  FEEDBACK_ADMIN_EMAILS: process.env.FEEDBACK_ADMIN_EMAILS,
  FEEDBACK_ADMIN_ROLES: process.env.FEEDBACK_ADMIN_ROLES,
  RASA_URL_LIST: process.env.RASA_URL_LIST,
  RASA_PROXY_TARGETS: process.env.RASA_PROXY_TARGETS,
  RASA_AUTH_TOKEN: process.env.RASA_AUTH_TOKEN,
  ACTION_SERVER_TOKEN: process.env.ACTION_SERVER_TOKEN,
  KEYCLOAK_ISSUER: process.env.KEYCLOAK_ISSUER,
  KEYCLOAK_CLIENT_ID: process.env.KEYCLOAK_CLIENT_ID,
  CVA_BASE_URL: process.env.CVA_BASE_URL,
  WEBAPP_VERSION_URL: process.env.WEBAPP_VERSION_URL,
  ACTION_VERSION_URL: process.env.ACTION_VERSION_URL,
};

function setCommonEnv() {
  process.env.NODE_ENV = "test";
  process.env.RASA_PROXY_TARGETS = JSON.stringify({
    graphql: "https://graphql.example.com",
    analytics: "https://analytics.example.com",
  });
  process.env.RASA_AUTH_TOKEN = "rasa-token";
  process.env.ACTION_SERVER_TOKEN = "action-token";
  process.env.KEYCLOAK_ISSUER = "https://keycloak.example.com/realms/cva";
  process.env.KEYCLOAK_CLIENT_ID = "client-id";
  process.env.CVA_BASE_URL = "https://cva.example.com";
  process.env.WEBAPP_VERSION_URL = "https://webapp.example.com/version";
  process.env.ACTION_VERSION_URL = "https://action.example.com/version";
  process.env.FEEDBACK_ADMIN_ROLES = "";
  process.env.RASA_URL_LIST = JSON.stringify([
    { lang: "en", url: "https://rasa-en.example.com" },
  ]);
}

function restoreEnv() {
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  process.env.FEEDBACK_ADMIN_EMAILS = ORIGINAL_ENV.FEEDBACK_ADMIN_EMAILS;
  process.env.FEEDBACK_ADMIN_ROLES = ORIGINAL_ENV.FEEDBACK_ADMIN_ROLES;
  process.env.RASA_URL_LIST = ORIGINAL_ENV.RASA_URL_LIST;
  process.env.RASA_PROXY_TARGETS = ORIGINAL_ENV.RASA_PROXY_TARGETS;
  process.env.RASA_AUTH_TOKEN = ORIGINAL_ENV.RASA_AUTH_TOKEN;
  process.env.ACTION_SERVER_TOKEN = ORIGINAL_ENV.ACTION_SERVER_TOKEN;
  process.env.KEYCLOAK_ISSUER = ORIGINAL_ENV.KEYCLOAK_ISSUER;
  process.env.KEYCLOAK_CLIENT_ID = ORIGINAL_ENV.KEYCLOAK_CLIENT_ID;
  process.env.CVA_BASE_URL = ORIGINAL_ENV.CVA_BASE_URL;
  process.env.WEBAPP_VERSION_URL = ORIGINAL_ENV.WEBAPP_VERSION_URL;
  process.env.ACTION_VERSION_URL = ORIGINAL_ENV.ACTION_VERSION_URL;
}

beforeEach(() => {
  setCommonEnv();
  authMock.mockReset();
  getRasaBotsMock.mockReset();
  withRasaAuthMock.mockReset();
  withRasaAuthMock.mockImplementation((url: string) => url);
  getRasaBotsMock.mockReturnValue([{ lang: "en", url: "https://rasa-en.example.com" }]);
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  ) as never;
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe("GET /api/runtime-health", () => {
  it("returns unauthorized when the session is missing", async () => {
    authMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });

  it("returns full diagnostics for an admin session", async () => {
    process.env.FEEDBACK_ADMIN_EMAILS = "admin@example.com";
    authMock.mockResolvedValue({
      accessToken: "access-token",
      isFeedbackAdmin: true,
      user: { id: "user-1", email: "admin@example.com", name: "Admin User" },
    });

    const response = await GET();
    const body = (await response.json()) as {
      visibility: string;
      services: Array<{ key: string; status: string }>;
      config: Array<{ key: string; status: string }>;
      external: Array<{ key: string; status: string }>;
    };

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.status).toBe(200);
    expect(body.visibility).toBe("full");
    const serviceKeys = body.services.map((item) => item.key);
    expect(serviceKeys).toContain("webapp");
    expect(serviceKeys).toContain("action");
    expect(serviceKeys.some((key) => key === "rasa" || key.startsWith("rasa:"))).toBe(true);
    expect(body.config.some((item) => item.key === "rasa_url_list" && item.status === "ok")).toBe(true);
    expect(body.external.some((item) => item.key === "upstream_graphql" && item.status === "up")).toBe(true);
  });

  it("reduces diagnostics for non-admin sessions", async () => {
    process.env.FEEDBACK_ADMIN_EMAILS = "";
    authMock.mockResolvedValue({
      accessToken: "access-token",
      isFeedbackAdmin: false,
      user: { id: "user-1", email: "user@example.com", name: "Normal User" },
    });

    const response = await GET();
    const body = (await response.json()) as {
      visibility: string;
      config: unknown[];
      services: Array<{ detail: string }>;
    };

    expect(body.visibility).toBe("limited");
    expect(body.config).toEqual([]);
    expect(body.services.every((item) => item.detail === "Service health issue detected" || item.detail === "Service reachable")).toBe(true);
  });
});