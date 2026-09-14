import { describe, expect, it } from "vitest";
import { isSampledIn, resolveInteractionLogDecision } from "@/lib/interactionLogCapture";
import type { InteractionLogSettings } from "@/lib/interactionLogSettingsStore";

function buildSettings(overrides: Partial<InteractionLogSettings> = {}): InteractionLogSettings {
  return {
    masterEnabled: true,
    mode: "allowlist",
    allowlistEmails: [],
    denylistEmails: [],
    samplePercentage: 0,
    retentionDays: 30,
    disclosureEnabled: true,
    storageIdentityMode: "identified",
    updatedAt: new Date(0).toISOString(),
    updatedByEmail: null,
    ...overrides,
  };
}

describe("resolveInteractionLogDecision", () => {
  it("everyone mode captures everyone except the denylist", () => {
    const settings = buildSettings({ mode: "everyone", denylistEmails: ["blocked@example.com"] });
    expect(resolveInteractionLogDecision(settings, "anyone@example.com")).toBe(true);
    expect(resolveInteractionLogDecision(settings, "blocked@example.com")).toBe(false);
  });

  it("allowlist mode captures only listed emails", () => {
    const settings = buildSettings({ mode: "allowlist", allowlistEmails: ["allowed@example.com"] });
    expect(resolveInteractionLogDecision(settings, "allowed@example.com")).toBe(true);
    expect(resolveInteractionLogDecision(settings, "someone-else@example.com")).toBe(false);
  });

  it("denylist mode captures everyone except listed emails", () => {
    const settings = buildSettings({ mode: "denylist", denylistEmails: ["blocked@example.com"] });
    expect(resolveInteractionLogDecision(settings, "anyone@example.com")).toBe(true);
    expect(resolveInteractionLogDecision(settings, "blocked@example.com")).toBe(false);
  });

  it("percentage mode respects the denylist first, then samples", () => {
    const settings = buildSettings({ mode: "percentage", samplePercentage: 100, denylistEmails: ["blocked@example.com"] });
    expect(resolveInteractionLogDecision(settings, "blocked@example.com")).toBe(false);
    expect(resolveInteractionLogDecision(settings, "anyone@example.com")).toBe(true);
  });

  it("returns false for an unknown mode", () => {
    const settings = buildSettings({ mode: "bogus" as never });
    expect(resolveInteractionLogDecision(settings, "anyone@example.com")).toBe(false);
  });
});

describe("isSampledIn", () => {
  it("is deterministic for the same email", () => {
    const first = isSampledIn("stable@example.com", 50);
    const second = isSampledIn("stable@example.com", 50);
    expect(first).toBe(second);
  });

  it("is case/whitespace insensitive", () => {
    expect(isSampledIn("Case@Example.com", 100)).toBe(isSampledIn(" case@example.com ", 100));
  });

  it("respects the 0 and 100 boundaries unconditionally", () => {
    expect(isSampledIn("anyone@example.com", 0)).toBe(false);
    expect(isSampledIn("anyone@example.com", 100)).toBe(true);
  });
});
