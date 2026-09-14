import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getInteractionLogIdentityFromSessionMock = vi.hoisted(() => vi.fn());
const listInteractionLogEntriesMock = vi.hoisted(() => vi.fn());
const featureFlags = vi.hoisted(() => ({
  interactionLogEnabled: true,
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/interactionLogAccess", () => ({
  getInteractionLogIdentityFromSession: getInteractionLogIdentityFromSessionMock,
}));

vi.mock("@/lib/interactionLogConfig", () => ({
  isInteractionLogEnabled: () => featureFlags.interactionLogEnabled,
}));

vi.mock("@/lib/interactionLogStore", () => ({
  listInteractionLogEntries: listInteractionLogEntriesMock,
}));

import { GET } from "@/app/api/admin/interaction-log/route";

beforeEach(() => {
  authMock.mockReset();
  getInteractionLogIdentityFromSessionMock.mockReset();
  listInteractionLogEntriesMock.mockReset();
  featureFlags.interactionLogEnabled = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/interaction-log", () => {
  it("returns not found when the feature is disabled", async () => {
    featureFlags.interactionLogEnabled = false;

    const response = await GET(new NextRequest("http://localhost/api/admin/interaction-log"));

    expect(response.status).toBe(404);
  });

  it("returns unauthorized without a session", async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/admin/interaction-log"));

    expect(response.status).toBe(401);
  });

  it("returns forbidden for non-admin sessions", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    getInteractionLogIdentityFromSessionMock.mockReturnValue({ isAdmin: false });

    const response = await GET(new NextRequest("http://localhost/api/admin/interaction-log"));

    expect(response.status).toBe(403);
  });

  it("passes validated filters to the interaction log store", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    getInteractionLogIdentityFromSessionMock.mockReturnValue({ isAdmin: true });
    listInteractionLogEntriesMock.mockResolvedValue({ total: 0, results: [] });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/interaction-log?userEmail=Someone@Example.com&source=sync&limit=250")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ total: 0, results: [] });
    expect(listInteractionLogEntriesMock).toHaveBeenCalledWith({
      userEmail: "Someone@Example.com",
      source: "sync",
      limit: 100,
    });
  });
});
