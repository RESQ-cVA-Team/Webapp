export type FeedbackIssueOption = {
  id: string;
  label: string;
};

export type FeedbackConfigResponse = {
  enabled: boolean;
  adminEnabled?: boolean;
  canViewAdmin?: boolean;
  captureConversationContext: boolean;
  commentMaxLength: number;
  disclosure: string;
  issues: FeedbackIssueOption[];
};

const FEEDBACK_CONFIG_TTL_MS = 30_000;
const DEFAULT_FEEDBACK_CONFIG: FeedbackConfigResponse = {
  enabled: false,
  adminEnabled: false,
  canViewAdmin: false,
  captureConversationContext: false,
  commentMaxLength: 0,
  disclosure: "",
  issues: [],
};

let cachedValue: FeedbackConfigResponse | null = null;
let cachedAt = 0;
let inflightPromise: Promise<FeedbackConfigResponse> | null = null;

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export async function getFeedbackConfigCached(forceRefresh = false): Promise<FeedbackConfigResponse> {
  const now = Date.now();
  const cacheFresh = now - cachedAt < FEEDBACK_CONFIG_TTL_MS;

  if (!forceRefresh && cachedValue && cacheFresh) {
    return cachedValue;
  }

  if (!forceRefresh && inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = fetch("/api/feedback/config", {
    method: "GET",
    cache: "no-store",
  })
  .then(async (response) => {
    if (!response.ok) {
      if (isAuthStatus(response.status)) {
        // Before login, /api/feedback/config returns 401/403. Treat this as
        // a benign "feature unavailable" state instead of an exception.
        return DEFAULT_FEEDBACK_CONFIG;
      }
      if (!isAuthStatus(response.status)) {
        console.error(`Failed to load feedback config: ${response.status} ${response.statusText}`);
      }
      throw new Error(`Failed to load feedback config (${response.status})`);
    }

    const payload = (await response.json()) as FeedbackConfigResponse;
    cachedValue = payload;
    cachedAt = Date.now();
    return payload;
  })
  .catch((error) => {
    if (!(error instanceof Error && /\(401\)|\(403\)/.test(error.message))) {
      console.error("Error fetching feedback config:", error);
    }
    throw error;
  })
  .finally(() => {
    inflightPromise = null;
  });

  return inflightPromise;
}
