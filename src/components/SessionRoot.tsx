"use client";
import { SessionProvider, useSession, signIn } from "next-auth/react";
import { usePathname } from "next/navigation";
import React, { useEffect } from "react";
import { toast } from "sonner";

const SHOW_DEV_AUTH_TOASTS = process.env.NODE_ENV === "development";

function SessionWatcher() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const lastRefreshRef = React.useRef<number | null>(null);

  useEffect(() => {
    if (pathname === "/signin") {
      return;
    }

    if (status === "unauthenticated" || session?.error === "RefreshAccessTokenError") {
      signIn("keycloak", { callbackUrl: window.location.href });
    }
  }, [pathname, session?.error, status]);

  useEffect(() => {
    if (!SHOW_DEV_AUTH_TOASTS) return;

    const refreshedAt =
      typeof session?.accessTokenRefreshedAt === "number"
        ? session.accessTokenRefreshedAt
        : null;
    if (!refreshedAt) return;

    if (lastRefreshRef.current === null) {
      lastRefreshRef.current = refreshedAt;
      return;
    }

    if (refreshedAt > lastRefreshRef.current) {
      toast("Access token refreshed", {
        description: `at ${new Date(refreshedAt).toLocaleTimeString()}`,
      });
    }

    lastRefreshRef.current = refreshedAt;
  }, [session?.accessTokenRefreshedAt]);

  return null;
}

function ThemeConsoleCommands() {
  useEffect(() => {
    window.setTheme = (theme) => {
      document.documentElement.setAttribute("data-theme", theme);
    };
    window.setDark = (enabled) => {
      if (enabled) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };
    console.info(
      "Theme commands available:\n" +
      "setTheme('blue') // or any theme name\n" +
      "setDark(true) // enable dark mode\n" +
      "setDark(false) // disable dark mode"
    );
  }, []);
  return null;
}

export default function SessionRoot({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={30} refetchOnWindowFocus>
      <SessionWatcher />
      <ThemeConsoleCommands />
      {children}
    </SessionProvider>
  );
}

declare global {
  interface Window {
    setTheme: (theme: string) => void;
    setDark: (enabled: boolean) => void;
  }
}
