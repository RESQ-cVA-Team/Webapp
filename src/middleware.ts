import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { edgeAuth } from "@/auth.edge";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "@/locales/config";

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

// req.auth is only set when the session cookie decrypts and has not expired,
// so a cookie that merely has the right name no longer gets past this.
export default edgeAuth((req) => {
  if (!req.auth) {
    const signInUrl = new URL("/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", `${req.nextUrl.pathname}${req.nextUrl.search}`);
    return ensureLanguageCookie(req, NextResponse.redirect(signInUrl));
  }

  return ensureLanguageCookie(req, NextResponse.next());
});

export const config = {
  matcher: ["/", "/admin/:path*"],
};
