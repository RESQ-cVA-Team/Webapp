import { promises as fs } from "fs";
import path from "path";

export type ThreadRecord = {
  id: number;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type CreateThreadOptions = {
  id?: number;
};

type RegistryData = {
  nextId: number;
  threads: ThreadRecord[];
};

const dataDirPath = path.join(process.cwd(), ".data");
const dataFilePath = path.join(dataDirPath, "thread-registry.json");

const DEFAULT_DATA: RegistryData = {
  nextId: 1,
  threads: [],
};

let writeQueue: Promise<unknown> = Promise.resolve();

function cloneDefaultData(): RegistryData {
  return {
    nextId: DEFAULT_DATA.nextId,
    threads: [],
  };
}

function normalizeUserId(userId: string): string {
  return String(userId ?? "").trim();
}

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(dataDirPath, { recursive: true });
  try {
    await fs.access(dataFilePath);
  } catch {
    await fs.writeFile(dataFilePath, JSON.stringify(DEFAULT_DATA, null, 2), "utf-8");
  }
}

async function readData(): Promise<RegistryData> {
  await ensureDataFile();
  try {
    const raw = await fs.readFile(dataFilePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RegistryData>;

    const nextId = typeof parsed.nextId === "number" && parsed.nextId > 0 ? parsed.nextId : 1;
    const threads = Array.isArray(parsed.threads)
      ? parsed.threads.filter((thread) => {
          if (!thread || typeof thread !== "object") return false;
          const candidate = thread as Partial<ThreadRecord>;
          return (
            typeof candidate.id === "number" &&
            typeof candidate.userId === "string" &&
            typeof candidate.name === "string" &&
            typeof candidate.createdAt === "string" &&
            typeof candidate.updatedAt === "string"
          );
        }) as ThreadRecord[]
      : [];

    return { nextId, threads };
  } catch {
    return cloneDefaultData();
  }
}

async function writeData(data: RegistryData): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(dataFilePath, JSON.stringify(data, null, 2), "utf-8");
}

function withWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const pendingTask = writeQueue.then(task, task);
  writeQueue = pendingTask.then(
    () => undefined,
    () => undefined
  );
  return pendingTask;
}

export async function listThreadsForUser(userId: string): Promise<ThreadRecord[]> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return [];

  const data = await readData();
  return data.threads
    .filter((thread) => thread.userId === normalizedUserId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createThreadForUser(userId: string, name?: string): Promise<ThreadRecord> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    throw new Error("Missing user id");
  }

  return createThreadForUserWithOptions(normalizedUserId, name);
}

async function createThreadForUserWithOptions(
  normalizedUserId: string,
  name?: string,
  options?: CreateThreadOptions
): Promise<ThreadRecord> {
  const explicitId =
    typeof options?.id === "number" && Number.isFinite(options.id) && options.id > 0
      ? Math.floor(options.id)
      : null;

  return withWriteLock(async () => {
    const data = await readData();
    const now = new Date().toISOString();
    const threadsForUser = data.threads.filter((thread) => thread.userId === normalizedUserId);
    const safeName = String(name ?? "").trim() || `Conversation ${threadsForUser.length + 1}`;
    const takenIds = new Set(data.threads.map((thread) => thread.id));

    const threadId = (() => {
      if (explicitId !== null && !takenIds.has(explicitId)) {
        return explicitId;
      }

      let candidate = data.nextId;
      while (takenIds.has(candidate)) {
        candidate += 1;
      }
      return candidate;
    })();

    const thread: ThreadRecord = {
      id: threadId,
      userId: normalizedUserId,
      name: safeName,
      createdAt: now,
      updatedAt: now,
    };

    data.nextId = Math.max(data.nextId, threadId + 1);
    data.threads.push(thread);
    await writeData(data);
    return thread;
  });
}

export async function createThreadForUserWithId(userId: string, threadId: number, name?: string): Promise<ThreadRecord> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    throw new Error("Missing user id");
  }

  return createThreadForUserWithOptions(normalizedUserId, name, { id: threadId });
}

export async function upsertThreadsForUser(userId: string, threadIds: number[]): Promise<ThreadRecord[]> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return [];

  const normalizedIds = Array.from(
    new Set(
      threadIds
        .filter((id) => Number.isFinite(id) && id > 0)
        .map((id) => Math.floor(id))
    )
  );

  if (normalizedIds.length === 0) {
    return listThreadsForUser(normalizedUserId);
  }

  await withWriteLock(async () => {
    const data = await readData();
    const now = new Date().toISOString();

    let changed = false;
    for (const threadId of normalizedIds) {
      const existing = data.threads.find((thread) => thread.userId === normalizedUserId && thread.id === threadId);
      if (existing) {
        continue;
      }

      data.threads.push({
        id: threadId,
        userId: normalizedUserId,
        name: `Conversation ${threadId}`,
        createdAt: now,
        updatedAt: now,
      });
      data.nextId = Math.max(data.nextId, threadId + 1);
      changed = true;
    }

    if (changed) {
      await writeData(data);
    }
  });

  return listThreadsForUser(normalizedUserId);
}

export async function renameThreadForUser(
  userId: string,
  threadId: number,
  name: string
): Promise<ThreadRecord | null> {
  const normalizedUserId = normalizeUserId(userId);
  const safeName = String(name ?? "").trim();

  if (!normalizedUserId || !safeName) return null;

  return withWriteLock(async () => {
    const data = await readData();
    const thread = data.threads.find((entry) => entry.userId === normalizedUserId && entry.id === threadId);
    if (!thread) return null;

    thread.name = safeName;
    thread.updatedAt = new Date().toISOString();
    await writeData(data);
    return thread;
  });
}

export async function touchThreadForUser(userId: string, threadId: number): Promise<ThreadRecord | null> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;

  return withWriteLock(async () => {
    const data = await readData();
    const thread = data.threads.find((entry) => entry.userId === normalizedUserId && entry.id === threadId);
    if (!thread) return null;

    thread.updatedAt = new Date().toISOString();
    await writeData(data);
    return thread;
  });
}

export async function deleteThreadForUser(userId: string, threadId: number): Promise<boolean> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return false;

  return withWriteLock(async () => {
    const data = await readData();
    const before = data.threads.length;
    data.threads = data.threads.filter((entry) => !(entry.userId === normalizedUserId && entry.id === threadId));
    if (data.threads.length === before) return false;
    await writeData(data);
    return true;
  });
}

export async function getThreadForUser(userId: string, threadId: number): Promise<ThreadRecord | null> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;

  const data = await readData();
  return data.threads.find((entry) => entry.userId === normalizedUserId && entry.id === threadId) ?? null;
}

// TODO: Swap this local file-backed store for Redis/Postgres when moving beyond
// experiments or when running multiple app instances.
