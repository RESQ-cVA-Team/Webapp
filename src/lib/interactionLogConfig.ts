const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isTruthy(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function readCsvEnv(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Deploy-time hard gate -- if unset, the feature doesn't exist in this
 * deployment at all: no admin UI, no capture code path, nothing. Distinct
 * from the runtime master switch in interactionLogSettingsStore.ts, which
 * controls whether an *existing* deployment is currently capturing. */
export function isInteractionLogEnabled(): boolean {
  return isTruthy(process.env.INTERACTION_LOG_ENABLED, false);
}

export function getInteractionLogAdminEmails(): string[] {
  return readCsvEnv("INTERACTION_LOG_ADMIN_EMAILS").map((item) => item.toLowerCase());
}

export function getInteractionLogAdminRoles(): string[] {
  return readCsvEnv("INTERACTION_LOG_ADMIN_ROLES").map((item) => item.toLowerCase());
}

/** Hard ceiling on admin-settable retention -- the one piece of retention
 * policy that stays in env rather than the runtime settings, so an admin
 * can never configure unbounded retention for a full-conversation,
 * real-identity log. */
export function getInteractionLogRetentionCapDays(): number {
  const parsed = Number(process.env.INTERACTION_LOG_MAX_RETENTION_DAYS ?? "90");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 90;
  }
  return Math.min(parsed, 365);
}

export function getInteractionLogAllowlistCap(): number {
  return 500;
}
