import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { keycloakIssuer } from "@/auth.config";
import { getUserTokenEntry } from "@/lib/userTokenVault";

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
  const sub = typeof token?.sub === "string" ? token.sub : null;
  const idToken = (sub ? (await getUserTokenEntry(sub))?.idToken : null) ?? null;

  // Without an id_token (turned away at sign-in, or the vault entry expired)
  // the client_id form still ends the session; Keycloak then asks the user to
  // confirm instead of ending it silently.
  const clientId = process.env.KEYCLOAK_CLIENT_ID?.trim();

  if (!keycloakIssuer || (!idToken && !clientId)) {
    return NextResponse.json({ url: null }, { status: 200 });
  }

  const baseUrl = (process.env.NEXTAUTH_URL || req.nextUrl.origin).replace(/\/$/, "");
  const logoutUrl = new URL(`${keycloakIssuer}/protocol/openid-connect/logout`);
  if (idToken) {
    logoutUrl.searchParams.set("id_token_hint", idToken);
  } else if (clientId) {
    logoutUrl.searchParams.set("client_id", clientId);
  }
  logoutUrl.searchParams.set("post_logout_redirect_uri", `${baseUrl}/`);

  return NextResponse.json({ url: logoutUrl.toString() }, { status: 200 });
}
