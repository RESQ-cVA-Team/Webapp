import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// These run the real Auth.js session check against real encrypted session
// cookies (no mocks of next-auth), since the point is what the middleware
// accepts and rejects. Env must be in place before @/auth.config loads.
const SECRET = vi.hoisted(() => {
  const secret = "middleware-test-secret-not-used-anywhere-else";
  process.env.NEXTAUTH_SECRET = secret;
  process.env.AUTH_TRUST_HOST = "true";
  process.env.KEYCLOAK_ISSUER = "https://keycloak.test/realms/cva";
  process.env.KEYCLOAK_CLIENT_ID = "cva";
  process.env.KEYCLOAK_CLIENT_SECRET = "client-secret";
  return secret;
});

import { encode } from "next-auth/jwt";
import middleware from "@/middleware";

const COOKIE = "authjs.session-token";

async function sessionCookie(options: { secret?: string; maxAge?: number } = {}): Promise<string> {
  return encode({
    token: { sub: "u1", email: "user@example.com", name: "User One" },
    secret: options.secret ?? SECRET,
    salt: COOKIE,
    maxAge: options.maxAge ?? 3600,
  });
}

function request(path: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`http://localhost${path}`, {
    headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), ...headers },
  });
}

async function run(req: NextRequest): Promise<Response> {
  const response = await (middleware as unknown as (r: NextRequest, e: unknown) => Promise<Response>)(req, {});
  return response;
}

function expectSignInRedirect(res: Response, callbackUrl: string) {
  expect(res.status).toBe(307);
  const location = new URL(res.headers.get("location") ?? "");
  expect(location.pathname).toBe("/signin");
  expect(location.searchParams.get("callbackUrl")).toBe(callbackUrl);
}

beforeAll(() => {
  expect(process.env.NEXTAUTH_SECRET).toBe(SECRET);
});

// Auth.js logs every rejected cookie as an error; that is the expected path here.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("middleware session check", () => {
  it("redirects to sign-in when there is no session cookie", async () => {
    expectSignInRedirect(await run(request("/")), "/");
  });

  it("lets a valid session cookie through", async () => {
    const res = await run(request("/", { [COOKIE]: await sessionCookie() }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects a cookie that only has the right name but is not a real session token", async () => {
    expectSignInRedirect(await run(request("/", { [COOKIE]: "not-a-real-token" })), "/");
  });

  it("redirects a session token encrypted with a different secret", async () => {
    const forged = await sessionCookie({ secret: "some-other-secret" });
    expectSignInRedirect(await run(request("/", { [COOKIE]: forged })), "/");
  });

  it("redirects an expired session token", async () => {
    const expired = await sessionCookie({ maxAge: -3600 });
    expectSignInRedirect(await run(request("/", { [COOKIE]: expired })), "/");
  });

  it("redirects a token issued for a different cookie name (wrong salt)", async () => {
    const wrongSalt = await encode({
      token: { sub: "u1" },
      secret: SECRET,
      salt: "authjs.callback-url",
      maxAge: 3600,
    });
    expectSignInRedirect(await run(request("/", { [COOKIE]: wrongSalt })), "/");
  });

  it("keeps the requested admin path and query as the callback", async () => {
    const res = await run(request("/admin/feedback?tab=open"));
    expectSignInRedirect(res, "/admin/feedback?tab=open");
  });
});

describe("middleware language cookie", () => {
  it("sets the language cookie on the sign-in redirect", async () => {
    const res = await run(request("/", {}, { "accept-language": "cs-CZ,cs;q=0.9" }));
    expect(res.headers.get("set-cookie")).toContain("lang=cs");
  });

  it("sets the language cookie on a normal pass-through too", async () => {
    const res = await run(request("/", { [COOKIE]: await sessionCookie() }, { "accept-language": "el" }));
    expect(res.headers.get("set-cookie")).toContain("lang=el");
  });

  it("leaves an existing language cookie alone", async () => {
    const res = await run(request("/", { [COOKIE]: await sessionCookie(), lang: "en" }));
    expect(res.headers.get("set-cookie") ?? "").not.toContain("lang=");
  });
});
