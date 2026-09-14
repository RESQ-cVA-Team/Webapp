// Phase 2 of the cross-service auth redesign: verifies bearer tokens via
// Keycloak's introspection endpoint (RFC 7662). Used both for Action's own
// service-account identity (see verifyActionServiceBearer below) --
// separate from Rasa's own introspection, which lives in Rasa's codebase
// since Rasa is the one verifying the *user's* token, not Webapp.
//
// Introspection only requires the caller to authenticate as *a* valid
// confidential client -- it doesn't need to be the client that issued the
// token being introspected, so this reuses Webapp's own existing
// KEYCLOAK_CLIENT_ID/_SECRET rather than requiring a separate credential.

export async function introspectToken(token: string): Promise<Record<string, unknown> | null> {
  const issuer = process.env.KEYCLOAK_ISSUER?.trim();
  const clientId = process.env.KEYCLOAK_CLIENT_ID?.trim();
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret || !token) {
    return null;
  }

  const url = `${issuer.replace(/\/$/, "")}/protocol/openid-connect/token/introspect`;
  const params = new URLSearchParams({ token, client_id: clientId, client_secret: clientSecret });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const payload = (await res.json()) as Record<string, unknown>;
    return payload?.active === true ? payload : null;
  } catch {
    return null;
  }
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

// Verifies a bearer token belongs to Action's own Keycloak service-account
// client (client_credentials grant, not a real user) -- this is the only
// proof of identity the Action-facing endpoints accept; the static
// ACTION_SERVER_TOKEN/LONG_TASK_CALLBACK_TOKEN shared secrets this replaced
// have been removed. Returns false (never throws) if ACTION_CLIENT_ID isn't
// configured -- callers should treat that as an unauthorized request, not a
// reason to skip the check.
export async function verifyActionServiceBearer(authHeader: string | null): Promise<boolean> {
  const expectedClientId = process.env.ACTION_CLIENT_ID?.trim();
  if (!expectedClientId) return false;

  const token = extractBearerToken(authHeader);
  if (!token) return false;

  const payload = await introspectToken(token);
  if (!payload) return false;

  const azp = typeof payload.azp === "string" ? payload.azp : null;
  const clientId = typeof payload.client_id === "string" ? payload.client_id : null;
  return (azp ?? clientId) === expectedClientId;
}
