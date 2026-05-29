import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "@/locales/config";

const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
] as const;

function ensureLanguageCookie(req: NextRequest, res: NextResponse) {
  const hasLang = req.cookies.get("lang");
  if (hasLang) {
    return res;
  }

  const accept = req.headers.get("accept-language") || "";
  const supported = SUPPORTED_LANGUAGES as readonly string[];
  const preferred = accept
    .split(",")
    .map((part) => part.trim().split(";")[0])
    .map((code) => code.split("-")[0])
    .find((code) => supported.includes(code));
  const lang = (preferred as typeof SUPPORTED_LANGUAGES[number]) || DEFAULT_LANGUAGE;

  res.cookies.set("lang", lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}

export default function middleware(req: NextRequest) {
  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));

  if (!hasSessionCookie) {
    const signInUrl = new URL("/api/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", `${req.nextUrl.pathname}${req.nextUrl.search}`);
    return ensureLanguageCookie(req, NextResponse.redirect(signInUrl));
  }

  return ensureLanguageCookie(req, NextResponse.next());
}

export const config = {
  matcher: ["/", "/admin/:path*"],
};
