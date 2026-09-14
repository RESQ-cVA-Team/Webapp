"use client";
import { SessionProvider, useSession, signIn } from "next-auth/react";
import { usePathname } from "next/navigation";
import React, { useEffect } from "react";

function SessionWatcher() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/signin") {
      return;
    }

    if (status === "unauthenticated" || session?.error === "RefreshAccessTokenError") {
      signIn("keycloak", { callbackUrl: window.location.href });
    }
  }, [pathname, session?.error, status]);

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
