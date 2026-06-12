import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { buildRasaSenderId } from "@/lib/rasaSender";
import { getRasaUrlForRequest, withRasaAuth } from "@/lib/rasaConfig";
import {
  createThreadForUser,
  createThreadForUserWithId,
  listThreadsForUser,
  upsertThreadsForUser,
} from "@/lib/threadRegistryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseThreadIdFromSenderId(userId: string, senderId: string): number | null {
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedSenderId = String(senderId ?? "").trim();
  if (!normalizedUserId || !normalizedSenderId) return null;

  const prefix = `${normalizedUserId}:thread:`;
  if (!normalizedSenderId.startsWith(prefix)) {
    return null;
  }

  const rawThreadId = normalizedSenderId.slice(prefix.length);
  if (!/^\d+$/.test(rawThreadId)) {
    return null;
  }

  const threadId = Number(rawThreadId);
  if (!Number.isFinite(threadId) || threadId <= 0) {
    return null;
  }

  return threadId;
}

function collectSenderIds(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectSenderIds(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.conversations)) {
    return collectSenderIds(record.conversations);
  }

  const candidateKeys = ["sender_id", "conversation_id", "conversationId", "id"] as const;
  for (const key of candidateKeys) {
    if (typeof record[key] === "string") {
      return [record[key] as string];
    }
  }

  return Object.keys(record)
    .filter((key) => key.includes(":thread:"))
    .map((key) => key.trim())
    .filter(Boolean);
}

async function listRasaThreadsByUser(userId: string): Promise<{ id: number; name: string; created_at: string; updated_at: string }[]> {
  if (!process.env.RASA_URL_LIST?.trim()) {
    return [];
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookiesMap = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value]));
  const apiUrl = getRasaUrlForRequest(headerStore, cookiesMap);
  if (!apiUrl) {
    return [];
  }

  try {
    const response = await fetch(withRasaAuth(`${apiUrl}/threads/by-user/${encodeURIComponent(userId)}`), {
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn("Failed to fetch thread index from Rasa", {
        userId,
        status: response.status,
        statusText: response.statusText,
      });
      return [];
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return [];
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
    console.warn("Failed to discover Rasa thread index for user", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function postIndexEvent(
  userId: string,
  threadId: number,
  action: "create" | "rename" | "delete",
  name: string = ""
): Promise<boolean> {
  if (!process.env.RASA_URL_LIST?.trim()) {
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

async function listRasaThreadIdsForUser(userId: string): Promise<number[]> {
  if (!process.env.RASA_URL_LIST?.trim()) {
    return [];
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookiesMap = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value]));
  const apiUrl = getRasaUrlForRequest(headerStore, cookiesMap);
  if (!apiUrl) {
    return [];
  }

  try {
    const response = await fetch(withRasaAuth(`${apiUrl}/conversations`), {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return [];
    }

    const payload = await response.json();
    const senderIds = collectSenderIds(payload);

    return Array.from(
      new Set(
        senderIds
          .map((senderId) => parseThreadIdFromSenderId(userId, senderId))
          .filter((threadId): threadId is number => threadId !== null)
      )
    );
  } catch (error) {
    console.warn("Failed to discover Rasa threads for user", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id ? String(session.user.id) : null;
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Fetch thread list from Rasa index endpoint
  const rasaThreads = await listRasaThreadsByUser(userId);
  
  // If we got threads from Rasa, upsert them to local store for metadata and return them
  if (rasaThreads.length > 0) {
    const threadIds = rasaThreads.map((t) => t.id);
    await upsertThreadsForUser(userId, threadIds);
    
    return NextResponse.json({
      results: rasaThreads.map((t) => ({
        id: t.id,
        name: t.name,
        created_at: t.created_at,
        updated_at: t.updated_at,
      })),
    });
  }

  // If no threads from Rasa, fall back to local store
  const threads = await listThreadsForUser(userId);
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

  const [localThreads, rasaThreads] = await Promise.all([
    listThreadsForUser(userId),
    listRasaThreadsByUser(userId),
  ]);

  const maxExistingThreadId = Math.max(
    0,
    ...localThreads.map((thread) => thread.id),
    ...rasaThreads.map((thread) => thread.id)
  );
  const nextThreadId = maxExistingThreadId + 1;

  const thread = nextThreadId > 0
    ? await createThreadForUserWithId(userId, nextThreadId, name)
    : await createThreadForUser(userId, name);

  // Bootstrap Rasa tracker
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookiesMap = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value]));
  const apiUrl = getRasaUrlForRequest(headerStore, cookiesMap);
  if (apiUrl) {
    const senderId = buildRasaSenderId(userId, thread.id);
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
    }

    // Post index event to Rasa
    await postIndexEvent(userId, thread.id, "create", name || "");
  }

  return NextResponse.json(thread, { status: 201 });
}
