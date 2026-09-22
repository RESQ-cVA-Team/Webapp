"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { CVA_ROLE_MISSING_ERROR } from "@/lib/cvaAccess";

export default function NoAccessPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  // Someone who does have access has no business here.
  useEffect(() => {
    if (status === "authenticated" && session?.error !== CVA_ROLE_MISSING_ERROR) {
      router.replace("/");
    }
  }, [router, session?.error, status]);

  // Ends the Keycloak SSO session too, not just this app's: otherwise signing
  // in again silently reuses the same account and lands right back here.
  const handleSignOut = async () => {
    setSigningOut(true);
    let logoutUrl: string | null = null;
    try {
      const res = await fetch("/api/auth/keycloak-logout-url?allowClientIdHint=1");
      if (res.ok) {
        const data = await res.json();
        logoutUrl = typeof data?.url === "string" ? data.url : null;
      }
    } catch {
      // Fall back to local-only sign-out below.
    }
    await signOut({ redirect: false });
    window.location.href = logoutUrl || "/";
  };

  const email = session?.user?.email ?? null;

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">No access to cVA</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {email ? `${email} is` : "Your account is"} signed in, but has not been granted access to cVA.
          If you should have access, ask an administrator to add it to your account, then sign in again.
        </p>
        <Button className="mt-6 w-full" disabled={signingOut} onClick={() => void handleSignOut()}>
          {signingOut ? "Signing out..." : "Sign out and use a different account"}
        </Button>
      </div>
    </div>
  );
}
