"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

function resolveCallbackUrl(rawCallbackUrl: string | null): string {
  if (!rawCallbackUrl) {
    return "/";
  }

  return rawCallbackUrl.startsWith("/") ? rawCallbackUrl : "/";
}

export default function SignInPage() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectStartedRef = useRef(false);

  const callbackUrl = useMemo(
    () => resolveCallbackUrl(searchParams.get("callbackUrl")),
    [searchParams]
  );

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(callbackUrl);
      return;
    }

    if (status !== "unauthenticated" || redirectStartedRef.current) {
      return;
    }

    redirectStartedRef.current = true;
    void signIn("keycloak", { callbackUrl });
  }, [callbackUrl, router, status]);

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Redirecting to sign in</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You will be sent to Keycloak to continue authentication.
        </p>
        <Button
          className="mt-6 w-full"
          onClick={() => {
            redirectStartedRef.current = true;
            void signIn("keycloak", { callbackUrl });
          }}
        >
          Continue to sign in
        </Button>
      </div>
    </div>
  );
}