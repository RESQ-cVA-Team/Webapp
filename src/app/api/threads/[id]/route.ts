import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { deleteThreadInRasa, getThreadFromRasa, renameThreadInRasa } from "@/lib/rasaThreadIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

function parseThreadId(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  const userId = session?.user?.id ? String(session.user.id) : null;
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const threadId = parseThreadId(id);
  if (!threadId) {
    return NextResponse.json({ message: "Invalid thread id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const name = typeof payload.name === "string" ? payload.name : "";

  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookiesMap = new Map(cookieStore.getAll().map((entry) => [entry.name, entry.value]));

  const updated = await renameThreadInRasa({
    headers: headerStore,
    cookies: cookiesMap,
    userId,
    threadId,
    name,
  });
  if (!updated) {
    return NextResponse.json({ message: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  const userId = session?.user?.id ? String(session.user.id) : null;
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const threadId = parseThreadId(id);
  if (!threadId) {
    return NextResponse.json({ message: "Invalid thread id" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookiesMap = new Map(cookieStore.getAll().map((entry) => [entry.name, entry.value]));

  // deleteThreadInRasa now calls the Rasa DELETE endpoint which handles
  // both hard-delete of the conversation tracker and the index soft-delete.
  const deleted = await deleteThreadInRasa({
    headers: headerStore,
    cookies: cookiesMap,
    userId,
    threadId,
  });
  if (!deleted) {
    return NextResponse.json({ message: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: threadId });
}
