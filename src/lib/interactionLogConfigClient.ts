export type InteractionLogConfigResponse = {
  enabled: boolean;
  canViewAdmin: boolean;
  noticeForCurrentUser: boolean;
};

const INTERACTION_LOG_CONFIG_TTL_MS = 30_000;
const DEFAULT_INTERACTION_LOG_CONFIG: InteractionLogConfigResponse = {
  enabled: false,
  canViewAdmin: false,
  noticeForCurrentUser: false,
};

let cachedValue: InteractionLogConfigResponse | null = null;
let cachedAt = 0;
let inflightPromise: Promise<InteractionLogConfigResponse> | null = null;

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export async function getInteractionLogConfigCached(forceRefresh = false): Promise<InteractionLogConfigResponse> {
  const now = Date.now();
  const cacheFresh = now - cachedAt < INTERACTION_LOG_CONFIG_TTL_MS;

  if (!forceRefresh && cachedValue && cacheFresh) {
    return cachedValue;
  }

  if (!forceRefresh && inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = fetch("/api/interaction-log/config", {
    method: "GET",
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) {
        if (isAuthStatus(response.status)) {
          return DEFAULT_INTERACTION_LOG_CONFIG;
        }
        console.error(`Failed to load interaction log config: ${response.status} ${response.statusText}`);
        throw new Error(`Failed to load interaction log config (${response.status})`);
      }

      const payload = (await response.json()) as InteractionLogConfigResponse;
      cachedValue = payload;
      cachedAt = Date.now();
      return payload;
    })
    .catch((error) => {
      if (!(error instanceof Error && /\(401\)|\(403\)/.test(error.message))) {
        console.error("Error fetching interaction log config:", error);
      }
      throw error;
    })
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}
