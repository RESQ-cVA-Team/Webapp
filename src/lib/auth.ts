import type { DefaultSession, NextAuthConfig } from "next-auth";
import type {} from "next-auth/jwt";
import { authBaseConfig } from "@/auth.config";
import { CVA_ROLE_MISSING_ERROR, NO_ACCESS_PATH, hasRequiredCvaRole } from "@/lib/cvaAccess";
import { isFeedbackAdmin } from "@/lib/feedbackAccess";
import { ACCESS_TOKEN_REFRESH_SAFETY_MS, ensureFreshUserTokens } from "@/lib/userTokenRefresh";
import { getUserAccessToken, getUserTokenEntry, putUserTokens } from "@/lib/userTokenVault";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
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
    idToken?: string;
    /** Whether the user's latest access token carried the required cVA role.
     * Only ever set from a token we hold; false means positively missing. */
    hasCvaRole?: boolean;
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
  const fallbackSignInUrl = `${normalizedBaseUrl}/signin`;

  const normalizeRelativeTarget = (target: string): string => {
    if (!target.startsWith("/")) {
      return normalizedBaseUrl;
    }

    if (target.startsWith("//")) {
      return normalizedBaseUrl;
    }

    if (target.startsWith("/api/auth/error") || target.startsWith("/auth/error")) {
      return fallbackSignInUrl;
    }

    return `${normalizedBaseUrl}${target}`;
  };

  if (!url) {
    return normalizedBaseUrl;
  }

  if (url.startsWith("/")) {
    return normalizeRelativeTarget(url);
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
      if (target.pathname.startsWith("/api/auth/error") || target.pathname.startsWith("/auth/error")) {
        return fallbackSignInUrl;
      }
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
    async signIn({ account, profile }) {
      // Only users holding the required Keycloak realm role may sign in at
      // all. Returning a path (not `false`) sends them to a dedicated page
      // instead of /auth/error, whose auto-redirect back to /signin would
      // loop for someone who keeps authenticating fine at Keycloak.
      if (hasRequiredCvaRole(account?.access_token)) {
        return true;
      }
      console.warn("[auth] Sign-in denied: access token lacks the required cVA role", {
        sub: typeof profile?.sub === "string" ? profile.sub : null,
      });
      return NO_ACCESS_PATH;
    },
    async jwt({ token, account, profile }) {
      // On every fresh sign-in, lock token.sub to the Keycloak user UUID sourced
      // directly from the ID-token claims (profile.sub). This is the only stable
      // identifier: account.providerAccountId and NextAuth's own token.sub can
      // both drift between sign-ins in NextAuth v5 beta.
      if (account && profile) {
        const keycloakSub =
          typeof (profile as Record<string, unknown>).sub === "string"
            ? ((profile as Record<string, unknown>).sub as string).trim()
            : null;
        if (keycloakSub) {
          token.sub = keycloakSub;
        }
      }

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
        // Kept only to support RP-initiated logout against Keycloak (see
        // api/auth/keycloak-logout-url) -- signOut() alone only clears this
        // app's own session, never Keycloak's SSO session, so signing back
        // in silently reuses it instead of prompting. Never refreshed after
        // initial sign-in (Keycloak's refresh_token grant doesn't return a
        // new id_token unless explicitly requested), which is fine -- it's
        // only ever used as id_token_hint, not as a credential.
        if (typeof account.id_token === "string") {
          token.idToken = account.id_token;
        }

        if (sessionSubject && typeof account.access_token === "string") {
          await putUserTokens({
            sub: sessionSubject,
            accessToken: account.access_token,
            refreshToken: typeof account.refresh_token === "string" ? account.refresh_token : null,
            accessTokenExpiresAt: token.accessTokenExpires,
          });
        }
      }

      const currentAccessToken = sessionSubject ? await getUserAccessToken(sessionSubject) : null;

      token.isFeedbackAdmin = isFeedbackAdmin({
        email: typeof token.email === "string" ? token.email : null,
        accessToken: currentAccessToken,
      });
      // Re-evaluated from whichever token we currently hold, so a role revoked
      // in Keycloak takes effect the next time the access token is refreshed.
      // With no token to read, the previous verdict stands (an unusable
      // session is handled by the refresh error path below instead).
      if (currentAccessToken) {
        token.hasCvaRole = hasRequiredCvaRole(currentAccessToken);
      }

      const refreshWindowStart =
        typeof token.accessTokenExpires === "number"
          ? token.accessTokenExpires - ACCESS_TOKEN_REFRESH_SAFETY_MS
          : undefined;

      if (typeof refreshWindowStart !== "number" || Date.now() < refreshWindowStart) {
        return token;
      }

      const fresh = sessionSubject ? await ensureFreshUserTokens(sessionSubject) : null;
      if (!fresh) {
        token.error = "RefreshAccessTokenError";
        return token;
      }

      token.hasCvaRole = hasRequiredCvaRole(fresh.accessToken);
      token.accessTokenExpires = fresh.expiresAt;
      if (fresh.refreshed) {
        token.accessTokenRefreshedAt = Date.now();
      }
      token.error = undefined;
      return token;
    },
    async session({ session, token }) {
      const sessionUserId = getSessionSubject({
        tokenSub: typeof token.sub === "string" ? token.sub : null,
        fallbackUserId: session.user?.id ?? null,
      });
      const currentAccessToken = sessionUserId ? await getUserAccessToken(sessionUserId) : null;
      const currentTokenEntry = sessionUserId ? await getUserTokenEntry(sessionUserId) : null;

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

      // Positively known to lack the cVA role: expose no user id or token, so
      // every route that gates on session.user.id / session.accessToken turns
      // them away, and mark the session so the UI can show a no-access page.
      if (token.hasCvaRole === false) {
        session.accessToken = undefined;
        session.isFeedbackAdmin = false;
        delete (session.user as { id?: string }).id;
        session.error = CVA_ROLE_MISSING_ERROR;
      }

      return session;
    },
  },
} satisfies NextAuthConfig;
