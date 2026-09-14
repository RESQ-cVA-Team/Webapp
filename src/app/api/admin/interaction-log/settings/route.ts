import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getInteractionLogIdentityFromSession } from "@/lib/interactionLogAccess";
import { isInteractionLogEnabled } from "@/lib/interactionLogConfig";
import { invalidateInteractionLogSettingsCache } from "@/lib/interactionLogSettingsCache";
import { readInteractionLogSettings, writeInteractionLogSettings } from "@/lib/interactionLogSettingsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_MODES = new Set(["everyone", "allowlist", "denylist", "percentage"]);
const VALID_IDENTITY_MODES = new Set(["identified", "pseudonymous"]);

type SettingsRequestBody = {
  masterEnabled?: unknown;
  mode?: unknown;
  allowlistEmails?: unknown;
  denylistEmails?: unknown;
  samplePercentage?: unknown;
  retentionDays?: unknown;
  disclosureEnabled?: unknown;
  storageIdentityMode?: unknown;
};

function normalizeEmailArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

async function requireAdmin() {
  if (!isInteractionLogEnabled()) {
    return { error: new NextResponse("Not found", { status: 404 }) } as const;
  }

  const session = await auth();
  if (!session) {
    return { error: new NextResponse("Unauthorized", { status: 401 }) } as const;
  }

  const identity = getInteractionLogIdentityFromSession(session);
  if (!identity.isAdmin) {
    return { error: new NextResponse("Forbidden", { status: 403 }) } as const;
  }

  return { identity } as const;
}

export async function GET() {
  const result = await requireAdmin();
  if ("error" in result) return result.error;

  const settings = await readInteractionLogSettings();
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const result = await requireAdmin();
  if ("error" in result) return result.error;

  let body: SettingsRequestBody;
  try {
    body = (await req.json()) as SettingsRequestBody;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  if (body.mode !== undefined && !VALID_MODES.has(String(body.mode))) {
    return NextResponse.json({ message: `mode must be one of: ${[...VALID_MODES].join(", ")}` }, { status: 400 });
  }

  if (body.storageIdentityMode !== undefined && !VALID_IDENTITY_MODES.has(String(body.storageIdentityMode))) {
    return NextResponse.json(
      { message: `storageIdentityMode must be one of: ${[...VALID_IDENTITY_MODES].join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const settings = await writeInteractionLogSettings({
      masterEnabled: typeof body.masterEnabled === "boolean" ? body.masterEnabled : undefined,
      mode: body.mode as never,
      allowlistEmails: normalizeEmailArray(body.allowlistEmails),
      denylistEmails: normalizeEmailArray(body.denylistEmails),
      samplePercentage: typeof body.samplePercentage === "number" ? body.samplePercentage : undefined,
      retentionDays: typeof body.retentionDays === "number" ? body.retentionDays : undefined,
      disclosureEnabled: typeof body.disclosureEnabled === "boolean" ? body.disclosureEnabled : undefined,
      storageIdentityMode: body.storageIdentityMode as never,
      updatedByEmail: result.identity.userEmail ?? null,
    });

    invalidateInteractionLogSettingsCache();

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to save interaction log settings", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to save interaction log settings" },
      { status: 500 }
    );
  }
}
