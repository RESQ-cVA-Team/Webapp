import { getRasaUrlForRequest, withUserBearerHeader } from "@/lib/rasaConfig";

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
  accessToken?: string | null;
}): Promise<ThreadRecord[] | null> {
  const apiUrl = await resolveRasaUrl(params.headers, params.cookies);
  if (!apiUrl) {
    return null;
  }

  const res = await fetch(`${apiUrl}/threads/by-user/${encodeURIComponent(params.userId)}`, {
    headers: withUserBearerHeader(undefined, params.accessToken),
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
  accessToken?: string | null;
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
  accessToken?: string | null;
}): Promise<ThreadRecord | null> {
  const apiUrl = await resolveRasaUrl(params.headers, params.cookies);
  if (!apiUrl) {
    return null;
  }

  // Rasa allocates the id and records the thread in one step, so concurrent
  // creates cannot end up sharing an id.
  const res = await fetch(`${apiUrl}/threads/by-user/${encodeURIComponent(params.userId)}`, {
    method: "POST",
    headers: withUserBearerHeader({ "Content-Type": "application/json" }, params.accessToken),
    body: JSON.stringify({ name: typeof params.name === "string" ? params.name.trim() : "" }),
  });
  if (!res.ok) {
    return null;
  }

  const payload = (await res.json()) as { thread?: RasaThread };
  return mapRasaThread(params.userId, payload.thread ?? {});
}

export async function renameThreadInRasa(params: {
  headers: Headers;
  cookies: Map<string, string>;
  userId: string;
  threadId: number;
  name: string;
  accessToken?: string | null;
}): Promise<ThreadRecord | null> {
  const trimmedName = params.name.trim();
  if (!trimmedName) {
    return null;
  }

  const apiUrl = await resolveRasaUrl(params.headers, params.cookies);
  if (!apiUrl) {
    return null;
  }

  // Rasa answers 404 for a thread that does not exist or was deleted.
  const res = await fetch(
    `${apiUrl}/threads/${encodeURIComponent(params.userId)}/thread/${encodeURIComponent(String(params.threadId))}`,
    {
      method: "PATCH",
      headers: withUserBearerHeader({ "Content-Type": "application/json" }, params.accessToken),
      body: JSON.stringify({ name: trimmedName }),
    }
  );
  if (!res.ok) {
    return null;
  }

  const payload = (await res.json()) as { thread?: RasaThread };
  return mapRasaThread(params.userId, payload.thread ?? {});
}

export async function deleteThreadInRasa(params: {
  headers: Headers;
  cookies: Map<string, string>;
  userId: string;
  threadId: number;
  accessToken?: string | null;
}): Promise<boolean> {
  const apiUrl = await resolveRasaUrl(params.headers, params.cookies);
  if (!apiUrl) {
    return false;
  }

  // Use the dedicated DELETE endpoint which handles both hard-delete of the
  // conversation tracker and the soft-delete index update in one atomic call.
  const res = await fetch(
    `${apiUrl}/threads/${encodeURIComponent(params.userId)}/thread/${encodeURIComponent(String(params.threadId))}`,
    { method: "DELETE", headers: withUserBearerHeader(undefined, params.accessToken), cache: "no-store" }
  );

  return res.ok;
}