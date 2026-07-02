import { getRasaUrlForRequest, withRasaAuth } from "@/lib/rasaConfig";

export type ThreadRecord = {
  id: number;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type RasaThread = {
  id?: unknown;
  name?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

function asIso(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : new Date().toISOString();
}

function mapRasaThread(userId: string, thread: RasaThread): ThreadRecord | null {
  const id = typeof thread.id === "number" && Number.isFinite(thread.id) ? thread.id : null;
  if (!id || id <= 0) {
    return null;
  }

  return {
    id,
    userId,
    name: typeof thread.name === "string" ? thread.name : "",
    createdAt: asIso(thread.created_at),
    updatedAt: asIso(thread.updated_at),
  };
}

async function resolveRasaUrl(headers: Headers, cookies: Map<string, string>): Promise<string | null> {
  return getRasaUrlForRequest(headers, cookies);
}

export async function listThreadsFromRasa(params: {
  headers: Headers;
  cookies: Map<string, string>;
  userId: string;
}): Promise<ThreadRecord[] | null> {
  const apiUrl = await resolveRasaUrl(params.headers, params.cookies);
  if (!apiUrl) {
    return null;
  }

  const res = await fetch(withRasaAuth(`${apiUrl}/threads/by-user/${encodeURIComponent(params.userId)}`), {
    cache: "no-store",
  });
  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { threads?: unknown[] };
  const source = Array.isArray(data.threads) ? data.threads : [];
  return source
    .map((item) => mapRasaThread(params.userId, item as RasaThread))
    .filter((item): item is ThreadRecord => !!item);
}

export async function getThreadFromRasa(params: {
  headers: Headers;
  cookies: Map<string, string>;
  userId: string;
  threadId: number;
}): Promise<ThreadRecord | null> {
  const threads = await listThreadsFromRasa(params);
  if (!threads) {
    return null;
  }
  return threads.find((thread) => thread.id === params.threadId) ?? null;
}

export async function createThreadInRasa(params: {
  headers: Headers;
  cookies: Map<string, string>;
  userId: string;
  name?: string;
}): Promise<ThreadRecord | null> {
  const apiUrl = await resolveRasaUrl(params.headers, params.cookies);
  if (!apiUrl) {
    return null;
  }

  const nextIdRes = await fetch(withRasaAuth(`${apiUrl}/threads/by-user/${encodeURIComponent(params.userId)}/next-id`), {
    cache: "no-store",
  });
  if (!nextIdRes.ok) {
    return null;
  }

  const nextIdPayload = (await nextIdRes.json()) as { next_thread_id?: unknown };
  const nextId =
    typeof nextIdPayload.next_thread_id === "number" && Number.isFinite(nextIdPayload.next_thread_id)
      ? nextIdPayload.next_thread_id
      : null;
  if (!nextId || nextId <= 0) {
    return null;
  }

  const trimmedName = typeof params.name === "string" ? params.name.trim() : "";
  const threadName = trimmedName || `Conversation ${nextId}`;

  const createRes = await fetch(withRasaAuth(`${apiUrl}/threads/${encodeURIComponent(params.userId)}/index-event`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      thread_id: nextId,
      action: "create",
      name: threadName,
    }),
  });

  if (!createRes.ok) {
    return null;
  }

  return {
    id: nextId,
    userId: params.userId,
    name: threadName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function renameThreadInRasa(params: {
  headers: Headers;
  cookies: Map<string, string>;
  userId: string;
  threadId: number;
  name: string;
}): Promise<ThreadRecord | null> {
  const trimmedName = params.name.trim();
  if (!trimmedName) {
    return null;
  }

  const existing = await getThreadFromRasa(params);
  if (!existing) {
    return null;
  }

  const apiUrl = await resolveRasaUrl(params.headers, params.cookies);
  if (!apiUrl) {
    return null;
  }

  const res = await fetch(withRasaAuth(`${apiUrl}/threads/${encodeURIComponent(params.userId)}/index-event`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      thread_id: params.threadId,
      action: "rename",
      name: trimmedName,
    }),
  });

  if (!res.ok) {
    return null;
  }

  return {
    ...existing,
    name: trimmedName,
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteThreadInRasa(params: {
  headers: Headers;
  cookies: Map<string, string>;
  userId: string;
  threadId: number;
}): Promise<boolean> {
  const apiUrl = await resolveRasaUrl(params.headers, params.cookies);
  if (!apiUrl) {
    return false;
  }

  // Use the dedicated DELETE endpoint which handles both hard-delete of the
  // conversation tracker and the soft-delete index update in one atomic call.
  const res = await fetch(
    withRasaAuth(
      `${apiUrl}/threads/${encodeURIComponent(params.userId)}/thread/${encodeURIComponent(String(params.threadId))}`
    ),
    { method: "DELETE", cache: "no-store" }
  );

  return res.ok;
}