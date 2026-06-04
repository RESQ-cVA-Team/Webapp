import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFeedbackIdentityFromSession } from "@/lib/feedbackAccess";
import { getAdminFeedbackById } from "@/lib/feedbackStore";
import { isFeedbackAdminEnabled, isMessageFeedbackEnabled } from "@/lib/feedbackConfig";

type Params = {
  params: Promise<{ id: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: Params) {
  if (!isMessageFeedbackEnabled() || !isFeedbackAdminEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const session = await auth();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const identity = getFeedbackIdentityFromSession(session);
  if (!identity.isAdmin) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const feedback = await getAdminFeedbackById(id);
  if (!feedback) {
    return NextResponse.json({ message: "Feedback not found" }, { status: 404 });
  }

  return NextResponse.json(feedback);
}