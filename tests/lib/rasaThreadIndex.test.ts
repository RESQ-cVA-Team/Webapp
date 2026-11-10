import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rasaConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rasaConfig")>()),
  getRasaUrlForRequest: () => "http://rasa:5005",
}));

import { createThreadInRasa, renameThreadInRasa } from "@/lib/rasaThreadIndex";

const fetchMock = vi.fn();
const base = { headers: new Headers(), cookies: new Map<string, string>(), userId: "user-1", accessToken: "tok" };
const rasaThread = { id: 7, name: "Conversation 7", created_at: "2026-11-10T09:00:00Z", updated_at: "2026-11-10T09:00:00Z" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});

afterEach(() => vi.restoreAllMocks());

describe("createThreadInRasa", () => {
  it("creates the thread in one request and returns the id Rasa allocated", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, thread: rasaThread }, 201));

    const thread = await createThreadInRasa({ ...base, name: "  Monthly DTN  " });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://rasa:5005/threads/by-user/user-1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Monthly DTN" });
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(thread).toEqual({
      id: 7,
      userId: "user-1",
      name: "Conversation 7",
      createdAt: rasaThread.created_at,
      updatedAt: rasaThread.updated_at,
    });
  });

  it("leaves naming to Rasa when no name is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, thread: rasaThread }, 201));

    await createThreadInRasa(base);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "" });
  });

  it("returns null when Rasa refuses", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "nope" }, 500));

    await expect(createThreadInRasa(base)).resolves.toBeNull();
  });
});

describe("renameThreadInRasa", () => {
  it("renames through the thread's own route and returns Rasa's record", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, thread: { ...rasaThread, name: "Stroke types" } }));

    const thread = await renameThreadInRasa({ ...base, threadId: 7, name: " Stroke types " });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://rasa:5005/threads/user-1/thread/7");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "Stroke types" });
    expect(thread?.name).toBe("Stroke types");
  });

  it("returns null for a thread Rasa does not have", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Thread not found" }, 404));

    await expect(renameThreadInRasa({ ...base, threadId: 9, name: "Gone" })).resolves.toBeNull();
  });

  it("does not call Rasa for a blank name", async () => {
    await expect(renameThreadInRasa({ ...base, threadId: 7, name: "   " })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
