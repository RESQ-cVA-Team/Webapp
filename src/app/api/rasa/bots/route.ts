import { NextResponse } from "next/server";
import { getRasaBots } from "@/lib/rasaConfig";

export async function GET() {
  const bots = getRasaBots();
  return NextResponse.json({ bots });
}
