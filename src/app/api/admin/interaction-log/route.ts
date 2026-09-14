import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getInteractionLogIdentityFromSession } from "@/lib/interactionLogAccess";
import { isInteractionLogEnabled } from "@/lib/interactionLogConfig";
import { listInteractionLogEntries } from "@/lib/interactionLogStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampLimit(input: string | null, fallback = 25): number {
  const parsed = Number(input ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

export async function GET(req: NextRequest) {
  if (!isInteractionLogEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const session = await auth();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const identity = getInteractionLogIdentityFromSession(session);
  if (!identity.isAdmin) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const userEmail = req.nextUrl.searchParams.get("userEmail");
  const sourceParam = req.nextUrl.searchParams.get("source");
  const source = sourceParam === "sync" || sourceParam === "long-task-callback" ? sourceParam : null;
  const limit = clampLimit(req.nextUrl.searchParams.get("limit"));

  try {
    const result = await listInteractionLogEntries({ userEmail, source, limit });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to load interaction log entries", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to load interaction log entries" },
      { status: 500 }
    );
  }
}
