import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { keycloakIssuer } from "@/auth.config";

// signOut() alone only clears this app's own NextAuth session -- it never
// tells Keycloak to end its own SSO session, so signing back in silently
// reuses the same Keycloak session instead of prompting for credentials
// (or letting a different user log in). This computes the RP-initiated
// logout URL (OIDC's standard mechanism for this) while the session is
// still valid; the caller is expected to redirect the browser there right
// after calling signOut() itself -- see topBarMenu.tsx.
export async function GET(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ url: null }, { status: 200 });
  }

  const token = await getToken({ req, secret });
  const idToken = typeof token?.idToken === "string" ? token.idToken : null;

  if (!keycloakIssuer || !idToken) {
    // Without an id_token we can't build a valid RP-initiated logout
    // request -- fall back to local-only sign-out rather than sending the
    // browser to Keycloak with no way to identify which session to end.
    return NextResponse.json({ url: null }, { status: 200 });
  }

  const baseUrl = (process.env.NEXTAUTH_URL || req.nextUrl.origin).replace(/\/$/, "");
  const logoutUrl = new URL(`${keycloakIssuer}/protocol/openid-connect/logout`);
  logoutUrl.searchParams.set("id_token_hint", idToken);
  logoutUrl.searchParams.set("post_logout_redirect_uri", `${baseUrl}/`);

  return NextResponse.json({ url: logoutUrl.toString() }, { status: 200 });
}
