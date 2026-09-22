"use client";
import { SessionProvider, useSession, signIn } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { CVA_ROLE_MISSING_ERROR, NO_ACCESS_PATH } from "@/lib/cvaAccess";
import React, { useEffect } from "react";

function SessionWatcher() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // The no-access page must be reachable without a session; sending an
    // unauthenticated visitor straight back to Keycloak from there would loop.
    if (pathname === "/signin" || pathname === NO_ACCESS_PATH) {
      return;
    }

    // Signed in, but the cVA role is gone: show why instead of re-signing in,
    // which would silently reuse the same Keycloak session.
    if (session?.error === CVA_ROLE_MISSING_ERROR) {
      router.replace(NO_ACCESS_PATH);
      return;
    }

    if (status === "unauthenticated" || session?.error === "RefreshAccessTokenError") {
      signIn("keycloak", { callbackUrl: window.location.href });
    }
  }, [pathname, router, session?.error, status]);

  return null;
}

export default function SessionRoot({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={30} refetchOnWindowFocus>
      <SessionWatcher />
      {children}
    </SessionProvider>
  );
}
