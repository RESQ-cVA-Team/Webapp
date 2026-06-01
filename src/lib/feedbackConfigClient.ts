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

let cachedValue: FeedbackConfigResponse | null = null;
let cachedAt = 0;
let inflightPromise: Promise<FeedbackConfigResponse> | null = null;

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
    console.error(`Failed to load feedback config: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to load feedback config (${response.status})`);
    }

    const payload = (await response.json()) as FeedbackConfigResponse;
    cachedValue = payload;
    cachedAt = Date.now();
    return payload;
  })
  .catch((error) => {
    console.error("Error fetching feedback config:", error);
    throw error;
  })
  .finally(() => {
    inflightPromise = null;
  });

  return inflightPromise;
}
