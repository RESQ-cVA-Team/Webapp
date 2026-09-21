import { describe, expect, it } from "vitest";
import { resolveSafeRedirect } from "@/lib/auth";

describe("resolveSafeRedirect", () => {
  it("keeps same-origin relative paths", () => {
    expect(resolveSafeRedirect("/threads?limit=1", "https://webapp.example.com")).toBe(
      "https://webapp.example.com/threads?limit=1"
    );
  });

  it("allows same-origin absolute URLs", () => {
    expect(resolveSafeRedirect("https://webapp.example.com/admin", "https://webapp.example.com")).toBe(
      "https://webapp.example.com/admin"
    );
  });

  it("rejects external callback URLs", () => {
    expect(resolveSafeRedirect("https://evil.example.com/phish", "https://webapp.example.com")).toBe(
      "https://webapp.example.com"
    );
  });

  it("keeps the no-access page, which the signIn callback redirects role-less users to", () => {
    expect(resolveSafeRedirect("/auth/no-access", "https://webapp.example.com")).toBe(
      "https://webapp.example.com/auth/no-access"
    );
  });

  it("rejects protocol-relative callback URLs", () => {
    expect(resolveSafeRedirect("//evil.example.com/phish", "https://webapp.example.com")).toBe(
      "https://webapp.example.com"
    );
  });
});