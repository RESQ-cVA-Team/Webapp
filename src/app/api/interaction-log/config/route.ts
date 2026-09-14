import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getInteractionLogIdentityFromSession } from "@/lib/interactionLogAccess";
import { isInteractionLogEnabled } from "@/lib/interactionLogConfig";
import { getInteractionLogSettingsCached } from "@/lib/interactionLogSettingsCache";
import { resolveInteractionLogDecision } from "@/lib/interactionLogCapture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const enabled = isInteractionLogEnabled();
  const identity = getInteractionLogIdentityFromSession(session);

  if (!enabled) {
    return NextResponse.json({ enabled: false, canViewAdmin: false, noticeForCurrentUser: false });
  }

  const settings = await getInteractionLogSettingsCached();
  const email = identity.userEmail?.trim().toLowerCase() ?? null;
  const noticeForCurrentUser =
    settings.masterEnabled && settings.disclosureEnabled && !!email && resolveInteractionLogDecision(settings, email);

  return NextResponse.json({
    enabled,
    canViewAdmin: identity.isAdmin,
    noticeForCurrentUser,
  });
}
