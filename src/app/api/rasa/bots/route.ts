import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRasaBots } from "@/lib/rasaConfig";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const bots = getRasaBots();
  return NextResponse.json({ bots });
}
