"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

function resolveNextPath(callbackUrl: string | null): string {
  if (callbackUrl && callbackUrl.startsWith("/")) {
    return callbackUrl;
  }
  return "/";
}

function describeAuthError(code: string | null): string {
  switch (code) {
    case "Configuration":
      return "Authentication is temporarily misconfigured. Please try again shortly.";
    case "AccessDenied":
      return "Access was denied by the identity provider.";
    case "Verification":
      return "Your sign-in link or session verification expired.";
    default:
      return "Authentication failed before the session could be established.";
  }
}

export default function AuthErrorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const errorCode = searchParams.get("error");
  const callbackUrl = searchParams.get("callbackUrl");
  const nextPath = useMemo(() => resolveNextPath(callbackUrl), [callbackUrl]);
  const message = useMemo(() => describeAuthError(errorCode), [errorCode]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const destination = `/signin?callbackUrl=${encodeURIComponent(nextPath)}`;
      router.replace(destination);
    }, 2500);

    return () => window.clearTimeout(timeoutId);
  }, [nextPath, router]);

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Sign-in issue</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        {errorCode ? (
          <p className="mt-2 text-xs text-muted-foreground">Error code: {errorCode}</p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2">
          <Button
            className="w-full"
            onClick={() => {
              const destination = `/signin?callbackUrl=${encodeURIComponent(nextPath)}`;
              router.replace(destination);
            }}
          >
            Back to sign in
          </Button>
          <Button
            className="w-full"
            variant="outline"
            onClick={() => router.replace("/")}
          >
            Go to home
          </Button>
        </div>
      </div>
    </div>
  );
}
