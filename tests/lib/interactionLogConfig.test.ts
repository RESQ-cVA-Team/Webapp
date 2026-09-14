import { afterEach, describe, expect, it } from "vitest";
import {
  getInteractionLogAdminEmails,
  getInteractionLogAdminRoles,
  getInteractionLogRetentionCapDays,
  isInteractionLogEnabled,
} from "@/lib/interactionLogConfig";

const ORIGINAL_ENV = {
  INTERACTION_LOG_ENABLED: process.env.INTERACTION_LOG_ENABLED,
  INTERACTION_LOG_ADMIN_EMAILS: process.env.INTERACTION_LOG_ADMIN_EMAILS,
  INTERACTION_LOG_ADMIN_ROLES: process.env.INTERACTION_LOG_ADMIN_ROLES,
  INTERACTION_LOG_MAX_RETENTION_DAYS: process.env.INTERACTION_LOG_MAX_RETENTION_DAYS,
};

afterEach(() => {
  process.env.INTERACTION_LOG_ENABLED = ORIGINAL_ENV.INTERACTION_LOG_ENABLED;
  process.env.INTERACTION_LOG_ADMIN_EMAILS = ORIGINAL_ENV.INTERACTION_LOG_ADMIN_EMAILS;
  process.env.INTERACTION_LOG_ADMIN_ROLES = ORIGINAL_ENV.INTERACTION_LOG_ADMIN_ROLES;
  process.env.INTERACTION_LOG_MAX_RETENTION_DAYS = ORIGINAL_ENV.INTERACTION_LOG_MAX_RETENTION_DAYS;
});

describe("interactionLogConfig", () => {
  it("defaults to disabled", () => {
    delete process.env.INTERACTION_LOG_ENABLED;
    expect(isInteractionLogEnabled()).toBe(false);
  });

  it("reads the enabled flag with the shared truthy convention", () => {
    process.env.INTERACTION_LOG_ENABLED = "yes";
    expect(isInteractionLogEnabled()).toBe(true);
  });

  it("parses admin email and role lists independently of feedback's lists", () => {
    process.env.INTERACTION_LOG_ADMIN_EMAILS = "Admin@Example.com, second@example.com";
    process.env.INTERACTION_LOG_ADMIN_ROLES = "Realm-Admin";

    expect(getInteractionLogAdminEmails()).toEqual(["admin@example.com", "second@example.com"]);
    expect(getInteractionLogAdminRoles()).toEqual(["realm-admin"]);
  });

  it("defaults and caps the retention ceiling", () => {
    delete process.env.INTERACTION_LOG_MAX_RETENTION_DAYS;
    expect(getInteractionLogRetentionCapDays()).toBe(90);

    process.env.INTERACTION_LOG_MAX_RETENTION_DAYS = "10000";
    expect(getInteractionLogRetentionCapDays()).toBe(365);

    process.env.INTERACTION_LOG_MAX_RETENTION_DAYS = "not-a-number";
    expect(getInteractionLogRetentionCapDays()).toBe(90);
  });
});
