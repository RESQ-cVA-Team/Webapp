import { readInteractionLogSettings, type InteractionLogSettings } from "@/lib/interactionLogSettingsStore";

const TTL_MS = 30_000;

const globalForInteractionLogCache = globalThis as unknown as {
  interactionLogSettingsCache?: InteractionLogSettings | null;
  interactionLogSettingsCacheAt?: number;
};

let cached: InteractionLogSettings | null = globalForInteractionLogCache.interactionLogSettingsCache ?? null;
let cachedAt = globalForInteractionLogCache.interactionLogSettingsCacheAt ?? 0;
let inflight: Promise<InteractionLogSettings> | null = null;

/** Server-side equivalent of feedbackConfigClient.ts's client-side cache.
 * The capture-decision hot path runs on every chat turn, so it must never
 * be a DB/file round trip -- this bounds staleness to TTL_MS instead. */
export async function getInteractionLogSettingsCached(): Promise<InteractionLogSettings> {
  const fresh = Date.now() - cachedAt < TTL_MS;
  if (cached && fresh) {
    return cached;
  }

  if (inflight) {
    return inflight;
  }

  inflight = readInteractionLogSettings()
    .then((settings) => {
      cached = settings;
      cachedAt = Date.now();
      globalForInteractionLogCache.interactionLogSettingsCache = cached;
      globalForInteractionLogCache.interactionLogSettingsCacheAt = cachedAt;
      return settings;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Called by the settings PUT handler after a successful write, so an
 * admin's own change is visible on their next request without waiting out
 * the TTL. Doesn't help other concurrent server processes/workers, but
 * bounds staleness to TTL_MS everywhere regardless. */
export function invalidateInteractionLogSettingsCache(): void {
  cached = null;
  cachedAt = 0;
  globalForInteractionLogCache.interactionLogSettingsCache = null;
  globalForInteractionLogCache.interactionLogSettingsCacheAt = 0;
}
