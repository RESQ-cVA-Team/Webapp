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

  // Keep local names/ordering metadata, but discover canonical thread IDs from Rasa conversations.
  const rasaThreadIds = await listRasaThreadIdsForUser(userId);
  if (rasaThreadIds.length > 0) {
    await upsertThreadsForUser(userId, rasaThreadIds);
  }

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

  const [localThreads, rasaThreadIds] = await Promise.all([
    listThreadsForUser(userId),
    listRasaThreadIdsForUser(userId),
  ]);

  const maxExistingThreadId = Math.max(
    0,
    ...localThreads.map((thread) => thread.id),
    ...rasaThreadIds
  );
  const nextThreadId = maxExistingThreadId + 1;

  const thread = nextThreadId > 0
    ? await createThreadForUserWithId(userId, nextThreadId, name)
    : await createThreadForUser(userId, name);

  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookiesMap = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value]));
  const apiUrl = getRasaUrlForRequest(headerStore, cookiesMap);
  if (apiUrl) {
    const senderId = buildRasaSenderId(userId, thread.id);
    try {
      const response = await fetch(withRasaAuth(`${apiUrl}/conversations/${senderId}/tracker/events`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event: "restart" }),
      });

      if (!response.ok) {
        console.warn("Rasa tracker bootstrap returned non-OK during thread creation", {
          apiUrl,
          senderId,
          status: response.status,
          statusText: response.statusText,
        });
      }
    } catch (error) {
      console.warn("Failed to bootstrap Rasa tracker during thread creation", {
        apiUrl,
        senderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json(thread, { status: 201 });
}
