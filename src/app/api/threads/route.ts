import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { createThreadInRasa, listThreadsFromRasa } from "@/lib/rasaThreadIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id ? String(session.user.id) : null;
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const threads = await listThreadsFromRasa({
    headers: headerStore,
    cookies: new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value])),
    userId,
  });
  if (!threads) {
    return NextResponse.json({ message: "Rasa thread index unavailable" }, { status: 502 });
  }
  return NextResponse.json({ results: threads });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id ? String(session.user.id) : null;
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const name = typeof payload.name === "string" ? payload.name : undefined;

  const cookieStore = await cookies();
  const headerStore = await headers();
  const thread = await createThreadInRasa({
    headers: headerStore,
    cookies: new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value])),
    userId,
    name,
  });
  if (!thread) {
    return NextResponse.json({ message: "Failed to create thread" }, { status: 502 });
  }
  return NextResponse.json(thread, { status: 201 });
}
