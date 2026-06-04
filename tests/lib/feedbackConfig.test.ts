import { afterEach, describe, expect, it } from "vitest";
import {
  clampFeedbackQueryLimit,
  getFeedbackAdminEmails,
  getFeedbackAdminRoles,
  isFeedbackAdminEnabled,
  normalizeFeedbackIssues,
  normalizeFeedbackRating,
  shouldCaptureFeedbackConversationContext,
} from "@/lib/feedbackConfig";

const ORIGINAL_ENV = {
  FEEDBACK_ADMIN_EMAILS: process.env.FEEDBACK_ADMIN_EMAILS,
  FEEDBACK_ADMIN_ROLES: process.env.FEEDBACK_ADMIN_ROLES,
  FEEDBACK_ADMIN_ENABLED: process.env.FEEDBACK_ADMIN_ENABLED,
  FEEDBACK_CAPTURE_CONTEXT_ENABLED: process.env.FEEDBACK_CAPTURE_CONTEXT_ENABLED,
};

afterEach(() => {
  process.env.FEEDBACK_ADMIN_EMAILS = ORIGINAL_ENV.FEEDBACK_ADMIN_EMAILS;
  process.env.FEEDBACK_ADMIN_ROLES = ORIGINAL_ENV.FEEDBACK_ADMIN_ROLES;
  process.env.FEEDBACK_ADMIN_ENABLED = ORIGINAL_ENV.FEEDBACK_ADMIN_ENABLED;
  process.env.FEEDBACK_CAPTURE_CONTEXT_ENABLED = ORIGINAL_ENV.FEEDBACK_CAPTURE_CONTEXT_ENABLED;
});

describe("feedbackConfig", () => {
  it("normalizes issue ids and removes invalid entries", () => {
    expect(
      normalizeFeedbackIssues(["slow_or_buggy", "slow_or_buggy", "not_valid", "other", 1])
    ).toEqual(["slow_or_buggy", "other"]);
  });

  it("normalizes rating values", () => {
    expect(normalizeFeedbackRating("up")).toBe("up");
    expect(normalizeFeedbackRating("down")).toBe("down");
    expect(normalizeFeedbackRating("maybe")).toBeNull();
  });

  it("clamps feedback query limits", () => {
    expect(clampFeedbackQueryLimit("5")).toBe(5);
    expect(clampFeedbackQueryLimit("500")).toBe(100);
    expect(clampFeedbackQueryLimit("not-a-number", 20)).toBe(20);
  });

  it("parses admin email and role lists", () => {
    process.env.FEEDBACK_ADMIN_EMAILS = "Admin@Example.com, second@example.com";
    process.env.FEEDBACK_ADMIN_ROLES = "Realm-Admin, Support";

    expect(getFeedbackAdminEmails()).toEqual(["admin@example.com", "second@example.com"]);
    expect(getFeedbackAdminRoles()).toEqual(["realm-admin", "support"]);
  });

  it("reads boolean env flags with sane defaults", () => {
    process.env.FEEDBACK_ADMIN_ENABLED = "yes";
    delete process.env.FEEDBACK_CAPTURE_CONTEXT_ENABLED;

    expect(isFeedbackAdminEnabled()).toBe(true);
    expect(shouldCaptureFeedbackConversationContext()).toBe(true);
  });
});