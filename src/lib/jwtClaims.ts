// Reads the claims of a JWT we already trust (a Keycloak access token that
// came straight from Keycloak's token endpoint or from our own vault). It does
// not verify the signature, so never use it on a token a caller supplied.
export function decodeJwtPayload(rawToken: string | null | undefined): Record<string, unknown> | null {
  if (!rawToken) return null;

  const parts = rawToken.split(".");
  if (parts.length < 2) return null;

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
