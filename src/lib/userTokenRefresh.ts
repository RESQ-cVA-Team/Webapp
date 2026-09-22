import { keycloakIssuer } from "@/auth.config";
import { getUserTokenEntry, putUserTokens } from "@/lib/userTokenVault";

const parsedRefreshSafetyMs = Number(process.env.NEXTAUTH_ACCESS_TOKEN_REFRESH_SAFETY_MS ?? "90000");
export const ACCESS_TOKEN_REFRESH_SAFETY_MS =
  Number.isFinite(parsedRefreshSafetyMs) && parsedRefreshSafetyMs >= 0 ? parsedRefreshSafetyMs : 90000;

export type FreshUserTokens = {
  accessToken: string;
  expiresAt: number;
  /** True only when this call actually ran the refresh_token grant. */
  refreshed: boolean;
};

// Keycloak may rotate the refresh token on every grant, so two concurrent
// refreshes for the same user would race and one would present an
// already-consumed token. Coalesce them onto a single in-flight promise.
const globalForRefresh = globalThis as unknown as {
  userTokenRefreshInflight?: Map<string, Promise<FreshUserTokens | null>>;
};
const inflightBySub = globalForRefresh.userTokenRefreshInflight ?? new Map<string, Promise<FreshUserTokens | null>>();
globalForRefresh.userTokenRefreshInflight = inflightBySub;

async function refreshFromKeycloak(sub: string, refreshToken: string): Promise<FreshUserTokens | null> {
  try {
    const response = await fetch(`${keycloakIssuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.KEYCLOAK_CLIENT_ID!,
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const refreshed = await response.json();
    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText} ${JSON.stringify(refreshed)}`);
    }

    const expiresIn = Number(refreshed.expires_in);
    if (typeof refreshed.access_token !== "string" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("Token refresh response missing access_token/expires_in");
    }

    const refreshedAt = Date.now();
    const expiresAt = refreshedAt + expiresIn * 1000;
    await putUserTokens({
      sub,
      accessToken: refreshed.access_token,
      refreshToken: typeof refreshed.refresh_token === "string" ? refreshed.refresh_token : refreshToken,
      accessTokenExpiresAt: expiresAt,
      accessTokenRefreshedAt: refreshedAt,
    });

    return { accessToken: refreshed.access_token, expiresAt, refreshed: true };
  } catch (error) {
    console.error("Failed to refresh access token:", error);
    return null;
  }
}

/**
 * Returns the user's vaulted access token, running the refresh_token grant
 * first when it is expired or inside the safety margin. Null means no usable
 * token exists (nothing vaulted, no refresh token, or Keycloak refused).
 */
export async function ensureFreshUserTokens(sub: string): Promise<FreshUserTokens | null> {
  const key = String(sub ?? "").trim();
  if (!key) return null;

  const inflight = inflightBySub.get(key);
  if (inflight) return inflight;

  const attempt = (async (): Promise<FreshUserTokens | null> => {
    const entry = await getUserTokenEntry(key);
    if (!entry) return null;

    if (entry.expiresAt - ACCESS_TOKEN_REFRESH_SAFETY_MS > Date.now()) {
      return { accessToken: entry.accessToken, expiresAt: entry.expiresAt, refreshed: false };
    }
    if (!entry.refreshToken) return null;

    return refreshFromKeycloak(key, entry.refreshToken);
  })().finally(() => {
    inflightBySub.delete(key);
  });

  inflightBySub.set(key, attempt);
  return attempt;
}

export async function getFreshUserAccessToken(sub: string): Promise<string | null> {
  return (await ensureFreshUserTokens(sub))?.accessToken ?? null;
}
