import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getFeedbackIdentityFromSessionMock = vi.hoisted(() => vi.fn());
const listAdminFeedbackMock = vi.hoisted(() => vi.fn());
const featureFlags = vi.hoisted(() => ({
  messageFeedbackEnabled: true,
  feedbackAdminEnabled: true,
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/feedbackAccess", () => ({
  getFeedbackIdentityFromSession: getFeedbackIdentityFromSessionMock,
}));

vi.mock("@/lib/feedbackConfig", () => ({
  clampFeedbackQueryLimit: (input: string | null | undefined, fallback: number) => {
    const parsed = Number(input ?? fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, 100);
  },
  FEEDBACK_ISSUE_OPTIONS: [
    { id: "slow_or_buggy" },
    { id: "other" },
  ],
  isFeedbackAdminEnabled: () => featureFlags.feedbackAdminEnabled,
  isMessageFeedbackEnabled: () => featureFlags.messageFeedbackEnabled,
}));

vi.mock("@/lib/feedbackStore", () => ({
  listAdminFeedback: listAdminFeedbackMock,
}));

import { GET } from "@/app/api/admin/feedback/route";

beforeEach(() => {
  authMock.mockReset();
  getFeedbackIdentityFromSessionMock.mockReset();
  listAdminFeedbackMock.mockReset();
  featureFlags.messageFeedbackEnabled = true;
  featureFlags.feedbackAdminEnabled = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/feedback", () => {
  it("returns not found when the feature is disabled", async () => {
    featureFlags.feedbackAdminEnabled = false;

    const response = await GET(new NextRequest("http://localhost/api/admin/feedback"));

    expect(response.status).toBe(404);
  });

  it("returns unauthorized without a session", async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/admin/feedback"));

    expect(response.status).toBe(401);
  });

  it("returns forbidden for non-admin sessions", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    getFeedbackIdentityFromSessionMock.mockReturnValue({ isAdmin: false });

    const response = await GET(new NextRequest("http://localhost/api/admin/feedback"));

    expect(response.status).toBe(403);
  });

  it("passes validated filters to the feedback store", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    getFeedbackIdentityFromSessionMock.mockReturnValue({ isAdmin: true });
    listAdminFeedbackMock.mockResolvedValue({ results: [] });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/feedback?rating=up&issue=slow_or_buggy&query=hello&limit=250")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [] });
    expect(listAdminFeedbackMock).toHaveBeenCalledWith({
      rating: "up",
      issueTag: "slow_or_buggy",
      query: "hello",
      limit: 100,
    });
  });
});