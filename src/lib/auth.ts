import type { DefaultSession, NextAuthConfig } from "next-auth";
import type {} from "next-auth/jwt";
import { authBaseConfig, keycloakIssuer } from "@/auth.config";
import { isFeedbackAdmin } from "@/lib/feedbackAccess";
import { getUserAccessToken, getUserTokenEntry, putUserTokens } from "@/lib/userTokenVault";

const parsedRefreshSafetyMs = Number(process.env.NEXTAUTH_ACCESS_TOKEN_REFRESH_SAFETY_MS ?? "90000");
const ACCESS_TOKEN_REFRESH_SAFETY_MS =
  Number.isFinite(parsedRefreshSafetyMs) && parsedRefreshSafetyMs >= 0
    ? parsedRefreshSafetyMs
    : 90000;

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    accessTokenRefreshedAt?: number;
    error?: string;
    isFeedbackAdmin?: boolean;
    user: DefaultSession["user"] & {
      id?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessTokenExpires?: number;
    accessTokenRefreshedAt?: number;
    error?: string;
    isFeedbackAdmin?: boolean;
  }
}

function getSessionSubject(params: {
  tokenSub?: string | null;
  accountProviderAccountId?: string | null;
  fallbackUserId?: string | null;
}): string | null {
  const candidates = [params.tokenSub, params.accountProviderAccountId, params.fallbackUserId];

  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function resolveSafeRedirect(url: string, baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, "");

  if (!url) {
    return normalizedBaseUrl;
  }

  if (url.startsWith("/")) {
    if (url.startsWith("//")) {
      return normalizedBaseUrl;
    }
    return `${normalizedBaseUrl}${url}`;
  }

  try {
    const target = new URL(url);
    const allowedOrigins = new Set<string>([new URL(normalizedBaseUrl).origin]);

    const configuredNextAuthUrl = process.env.NEXTAUTH_URL?.trim();
    if (configuredNextAuthUrl) {
      try {
        allowedOrigins.add(new URL(configuredNextAuthUrl).origin);
      } catch {
        // Ignore invalid NEXTAUTH_URL here; runtime config validation belongs elsewhere.
      }
    }

    if (allowedOrigins.has(target.origin)) {
      return target.toString();
    }
  } catch {
    // Fall back to the base URL on malformed absolute callback URLs.
  }

  return normalizedBaseUrl;
}

export const authConfig = {
  ...authBaseConfig,
  callbacks: {
    async redirect({ url, baseUrl }) {
      return resolveSafeRedirect(url, baseUrl);
    },
    async jwt({ token, account }) {
      const sessionSubject = getSessionSubject({
        tokenSub: typeof token.sub === "string" ? token.sub : null,
        accountProviderAccountId:
          typeof account?.providerAccountId === "string" ? account.providerAccountId : null,
      });

      if (account) {
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 60 * 60 * 1000;
        token.error = undefined;

        if (sessionSubject && typeof account.access_token === "string") {
          putUserTokens({
            sub: sessionSubject,
            accessToken: account.access_token,
            refreshToken: typeof account.refresh_token === "string" ? account.refresh_token : null,
            accessTokenExpiresAt: token.accessTokenExpires,
          });
        }
      }

      const currentTokenEntry = sessionSubject ? getUserTokenEntry(sessionSubject) : null;
      const currentAccessToken = sessionSubject ? getUserAccessToken(sessionSubject) : null;

      token.isFeedbackAdmin = isFeedbackAdmin({
        email: typeof token.email === "string" ? token.email : null,
        accessToken: currentAccessToken,
      });

      const now = Date.now();
      const refreshWindowStart =
        typeof token.accessTokenExpires === "number"
          ? token.accessTokenExpires - ACCESS_TOKEN_REFRESH_SAFETY_MS
          : undefined;

      if (
        typeof refreshWindowStart === "number" &&
        now < refreshWindowStart
      ) {
        return token;
      }

      if (
        typeof refreshWindowStart === "number" &&
        now >= refreshWindowStart
      ) {
        if (currentTokenEntry?.refreshToken) {
          try {
            const url = `${keycloakIssuer}/protocol/openid-connect/token`;
            const params = new URLSearchParams({
              client_id: process.env.KEYCLOAK_CLIENT_ID!,
              client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
              grant_type: "refresh_token",
              refresh_token: currentTokenEntry.refreshToken,
            });

            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: params,
            });

            const refreshedTokens = await response.json();

            if (!response.ok) {
              throw new Error(
                `Token refresh failed: ${response.status} ${response.statusText} ${JSON.stringify(refreshedTokens)}`
              );
            }

            token.accessTokenExpires = Date.now() + refreshedTokens.expires_in * 1000;
            token.accessTokenRefreshedAt = Date.now();
            token.error = undefined;

            if (sessionSubject && typeof refreshedTokens.access_token === "string") {
              putUserTokens({
                sub: sessionSubject,
                accessToken: refreshedTokens.access_token,
                refreshToken:
                  typeof refreshedTokens.refresh_token === "string"
                    ? refreshedTokens.refresh_token
                    : currentTokenEntry.refreshToken,
                accessTokenExpiresAt: token.accessTokenExpires,
                accessTokenRefreshedAt: token.accessTokenRefreshedAt,
              });
            }

            return token;
          } catch (error) {
            token.error = "RefreshAccessTokenError";
            console.error("Failed to refresh access token:", error);
            return token;
          }
        } else {
          token.error = "RefreshAccessTokenError";
          return token;
        }
      }

      return token;
    },
    async session({ session, token }) {
      const sessionUserId = getSessionSubject({
        tokenSub: typeof token.sub === "string" ? token.sub : null,
        fallbackUserId: session.user?.id ?? null,
      });
      const currentAccessToken = sessionUserId ? getUserAccessToken(sessionUserId) : null;
      const currentTokenEntry = sessionUserId ? getUserTokenEntry(sessionUserId) : null;

      session.accessToken = currentAccessToken ?? undefined;
      session.accessTokenExpires = typeof token.accessTokenExpires === "number" ? token.accessTokenExpires : undefined;
      session.accessTokenRefreshedAt =
        typeof token.accessTokenRefreshedAt === "number"
          ? token.accessTokenRefreshedAt
          : currentTokenEntry?.refreshedAt;
      session.isFeedbackAdmin = token.isFeedbackAdmin === true;
      session.user = {
        ...session.user,
        ...(sessionUserId ? { id: sessionUserId } : {}),
        email: typeof token.email === "string" ? token.email : session.user?.email ?? undefined,
        name: typeof token.name === "string" ? token.name : session.user?.name ?? undefined,
      };

      if (token.error) {
        session.error = token.error as string;
      } else if (!session.accessToken && sessionUserId) {
        session.error = "RefreshAccessTokenError";
      }

      return session;
    },
  },
} satisfies NextAuthConfig;
