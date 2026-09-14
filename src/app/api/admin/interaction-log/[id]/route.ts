import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getInteractionLogIdentityFromSession } from "@/lib/interactionLogAccess";
import { isInteractionLogEnabled } from "@/lib/interactionLogConfig";
import { getInteractionLogEntryById } from "@/lib/interactionLogStore";

type Params = {
  params: Promise<{ id: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: Params) {
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

  const { id } = await params;
  const entry = await getInteractionLogEntryById(id);
  if (!entry) {
    return NextResponse.json({ message: "Interaction log entry not found" }, { status: 404 });
  }

  return NextResponse.json(entry);
}
