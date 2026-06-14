import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { buildRasaSenderId } from "@/lib/rasaSender";
import { getRasaUrlForRequest, withRasaAuth } from "@/lib/rasaConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RasaThreadRecord = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

async function resolveRasaApiUrl(): Promise<string | null> {
  if (!process.env.RASA_URL_LIST?.trim()) {
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

  try {
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
  } catch (error) {
    throw new Error(
      `Failed to fetch Rasa thread index: ${error instanceof Error ? error.message : String(error)}`
    );
  }
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

async function getNextThreadId(userId: string): Promise<number | null> {
  const apiUrl = await resolveRasaApiUrl();
  if (!apiUrl) {
    return null;
  }

  try {
    const response = await fetch(
      withRasaAuth(`${apiUrl}/threads/by-user/${encodeURIComponent(userId)}/next-id`),
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const candidate = Number(payload?.next_thread_id);
    if (!Number.isFinite(candidate) || candidate <= 0) {
      return null;
    }

    return Math.floor(candidate);
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id ? String(session.user.id) : null;
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const rasaThreads = await listRasaThreadsByUser(userId);
    return NextResponse.json(
      { results: rasaThreads },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to fetch Rasa threads" },
      { status: 502 }
    );
  }
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

  let rasaThreads: RasaThreadRecord[];
  try {
    rasaThreads = await listRasaThreadsByUser(userId);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to fetch Rasa threads" },
      { status: 502 }
    );
  }

  const maxExistingThreadId = Math.max(0, ...rasaThreads.map((thread) => thread.id));
  const nextThreadIdFromRasa = await getNextThreadId(userId);
  const nextThreadId = nextThreadIdFromRasa ?? (maxExistingThreadId + 1);
  const createdName = name?.trim() || `New Thread ${nextThreadId}`;

  // Bootstrap Rasa tracker
  const apiUrl = await resolveRasaApiUrl();
  if (apiUrl) {
    const senderId = buildRasaSenderId(userId, nextThreadId);
    try {
      await fetch(withRasaAuth(`${apiUrl}/conversations/${senderId}/tracker/events`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event: "restart" }),
      });
    } catch (error) {
      console.warn("Failed to bootstrap Rasa tracker during thread creation", {
        apiUrl,
        senderId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ message: "Failed to initialize Rasa tracker" }, { status: 502 });
    }

    // Post index event to Rasa
    const posted = await postIndexEvent(userId, nextThreadId, "create", createdName);
    if (!posted) {
      return NextResponse.json({ message: "Failed to persist thread index in Rasa" }, { status: 502 });
    }

    try {
      const refreshedThreads = await listRasaThreadsByUser(userId);
      const createdThread = refreshedThreads.find((thread) => thread.id === nextThreadId);
      if (createdThread) {
        return NextResponse.json(createdThread, { status: 201 });
      }
    } catch {
      // Return fallback payload when refetch fails after successful create.
    }

    return NextResponse.json(
      {
        id: nextThreadId,
        name: createdName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { status: 201 }
    );
  }

  return NextResponse.json({ message: "Rasa not configured for current request" }, { status: 502 });
}
