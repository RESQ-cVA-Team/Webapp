import KeycloakProvider from "next-auth/providers/keycloak";
import type { AuthOptions, DefaultSession } from "next-auth";
import { isFeedbackAdmin } from "@/lib/feedbackAccess";

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
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    accessTokenRefreshedAt?: number;
    error?: string;
    isFeedbackAdmin?: boolean;
  }
}

export const authOptions: AuthOptions = {
  providers: [
    KeycloakProvider({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      issuer: process.env.KEYCLOAK_ISSUER!,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 60 * 60 * 1000;
        token.error = undefined;
      }

      token.isFeedbackAdmin = isFeedbackAdmin({
        email: typeof token.email === "string" ? token.email : null,
        accessToken: typeof token.accessToken === "string" ? token.accessToken : null,
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
        if (token.refreshToken) {
          try {
            const url = `${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/token`;
            const params = new URLSearchParams({
              client_id: process.env.KEYCLOAK_CLIENT_ID!,
              client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
              grant_type: "refresh_token",
              refresh_token: token.refreshToken as string,
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

            token.accessToken = refreshedTokens.access_token;
            token.accessTokenExpires = Date.now() + refreshedTokens.expires_in * 1000;
            token.refreshToken = refreshedTokens.refresh_token ?? token.refreshToken;
            token.accessTokenRefreshedAt = Date.now();
            token.error = undefined;
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
      session.accessToken = typeof token.accessToken === "string" ? token.accessToken : undefined;
      session.refreshToken = typeof token.refreshToken === "string" ? token.refreshToken : undefined;
      session.accessTokenExpires = typeof token.accessTokenExpires === "number" ? token.accessTokenExpires : undefined;
      session.accessTokenRefreshedAt =
        typeof token.accessTokenRefreshedAt === "number" ? token.accessTokenRefreshedAt : undefined;
      session.isFeedbackAdmin = token.isFeedbackAdmin === true;
      session.user = {
        ...session.user,
        id: typeof token.sub === "string" ? token.sub : undefined,
        email: typeof token.email === "string" ? token.email : session.user?.email ?? undefined,
        name: typeof token.name === "string" ? token.name : session.user?.name ?? undefined,
      };
      if (token.error) session.error = token.error as string;
      return session;
    },
  },
};
