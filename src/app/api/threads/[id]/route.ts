import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { getRasaUrlForRequest, withRasaAuth } from "@/lib/rasaConfig";
import { buildRasaSenderId } from "@/lib/rasaSender";
import { deleteThreadForUser, getThreadForUser, renameThreadForUser, upsertThreadsForUser } from "@/lib/threadRegistryStore";

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

async function postIndexEvent(
  userId: string,
  threadId: number,
  action: "create" | "rename" | "delete",
  name: string = ""
): Promise<boolean> {
  const rasa_url = process.env.RASA_URL_LIST?.trim();
  if (!rasa_url) {
    return false;
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookiesMap = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value]));
  const apiUrl = getRasaUrlForRequest(headerStore, cookiesMap);
  if (!apiUrl) {
    return false;
  }

  try {
    const response = await fetch(
      withRasaAuth(`${apiUrl}/threads/${encodeURIComponent(userId)}/index-event`),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          thread_id: threadId,
          name,
          action,
        }),
      }
    );

    if (!response.ok) {
      console.warn("Failed to post index event to Rasa", {
        userId,
        threadId,
        action,
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.warn("Failed to post index event to Rasa", {
      userId,
      threadId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
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

  await upsertThreadsForUser(userId, [threadId]);

  const updated = await renameThreadForUser(userId, threadId, name);
  if (!updated) {
    return NextResponse.json({ message: "Thread not found" }, { status: 404 });
  }

  // Post rename event to Rasa index
  await postIndexEvent(userId, threadId, "rename", name);

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

  await upsertThreadsForUser(userId, [threadId]);

  const existingThread = await getThreadForUser(userId, threadId);
  if (!existingThread) {
    return NextResponse.json({ message: "Thread not found" }, { status: 404 });
  }

  const deleted = await deleteThreadForUser(userId, threadId);
  if (!deleted) {
    return NextResponse.json({ message: "Thread not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const apiUrl = getRasaUrlForRequest(headerStore, new Map(cookieStore.getAll().map((entry) => [entry.name, entry.value])));

  if (apiUrl) {
    const senderId = buildRasaSenderId(userId, threadId);
    try {
      await fetch(withRasaAuth(`${apiUrl}/conversations/${senderId}/tracker/events`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event: "restart" }),
      });
    } catch (error) {
      console.warn("Failed to reset Rasa tracker during thread deletion", {
        apiUrl,
        senderId,
        error,
      });
    }

    // Post delete event to Rasa index
    await postIndexEvent(userId, threadId, "delete", "");
  }

  return NextResponse.json({ ok: true, id: existingThread.id });
}
