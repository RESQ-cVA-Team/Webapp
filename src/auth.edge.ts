import NextAuth from "next-auth";

import { authBaseConfig } from "@/auth.config";

// Edge-safe auth for middleware: same provider, secret and JWT session
// strategy as src/auth.ts, but without src/lib/auth.ts's callbacks, which read
// the Redis token vault and are Node-only. It decrypts the session JWT with
// NEXTAUTH_SECRET and checks its expiry, so a missing, forged, or expired
// cookie yields no session. It does not consult Keycloak or the vault; API
// routes still call the full `auth()` for that.
export const { auth: edgeAuth } = NextAuth(authBaseConfig);
