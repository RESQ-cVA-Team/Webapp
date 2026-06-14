import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { getRasaUrlForRequest, withRasaAuth } from "@/lib/rasaConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

type RasaThreadRecord = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

function parseThreadId(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

async function resolveRasaApiUrl(): Promise<string | null> {
  const rasaUrlList = process.env.RASA_URL_LIST?.trim();
  if (!rasaUrlList) {
    return null;
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookiesMap = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value]));
  return getRasaUrlForRequest(headerStore, cookiesMap);
}

async function listRasaThreadsByUser(userId: string): Promise<RasaThreadRecord[]> {
  const apiUrl = await resolveRasaApiUrl();
  if (!apiUrl) {
    throw new Error("Rasa not configured for current request");
  }

  const response = await fetch(withRasaAuth(`${apiUrl}/threads/by-user/${encodeURIComponent(userId)}`), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Rasa thread index request failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Rasa thread index returned non-JSON content");
  }

  const payload = await response.json();
  const threads = payload.threads || [];
  return threads.map((thread: any) => ({
    id: thread.id,
    name: thread.name,
    created_at: thread.created_at,
    updated_at: thread.updated_at,
  }));
}

async function postIndexEvent(
  userId: string,
  threadId: number,
  action: "create" | "rename" | "delete",
  name: string = ""
): Promise<boolean> {
  const apiUrl = await resolveRasaApiUrl();
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

  let existing: RasaThreadRecord | undefined;
  try {
    existing = (await listRasaThreadsByUser(userId)).find((thread) => thread.id === threadId);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to fetch Rasa threads" },
      { status: 502 }
    );
  }

  if (!existing) {
    return NextResponse.json({ message: "Thread not found" }, { status: 404 });
  }

  // Post rename event to Rasa index
  const posted = await postIndexEvent(userId, threadId, "rename", name);
  if (!posted) {
    return NextResponse.json({ message: "Failed to update thread in Rasa index" }, { status: 502 });
  }

  try {
    const renamed = (await listRasaThreadsByUser(userId)).find((thread) => thread.id === threadId);
    if (renamed) {
      return NextResponse.json(renamed);
    }
  } catch {
    // Return fallback payload when refetch fails after successful rename.
  }

  return NextResponse.json({
    id: threadId,
    name,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
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

  let existingThread: RasaThreadRecord | undefined;
  try {
    existingThread = (await listRasaThreadsByUser(userId)).find((thread) => thread.id === threadId);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to fetch Rasa threads" },
      { status: 502 }
    );
  }

  if (!existingThread) {
    return NextResponse.json({ message: "Thread not found" }, { status: 404 });
  }

  const apiUrl = await resolveRasaApiUrl();

  if (apiUrl) {
    try {
      const purgeResponse = await fetch(
        withRasaAuth(`${apiUrl}/threads/${encodeURIComponent(userId)}/thread/${threadId}`),
        {
          method: "DELETE",
        }
      );

      if (!purgeResponse.ok) {
        return NextResponse.json(
          { message: `Failed to purge thread in Rasa tracker (${purgeResponse.status})` },
          { status: 502 }
        );
      }

      const purgePayload = await purgeResponse.json().catch(() => ({}));
      const purged = purgePayload?.purged === true;
      return NextResponse.json({
        ok: true,
        id: existingThread.id,
        purged,
        index_deleted: true,
      });
    } catch (error) {
      console.warn("Failed to purge Rasa tracker during thread deletion", {
        apiUrl,
        threadId,
        error,
      });
      return NextResponse.json({ message: "Failed to purge thread in Rasa tracker" }, { status: 502 });
    }
  }

  return NextResponse.json({ message: "Rasa not configured for current request" }, { status: 502 });
}
