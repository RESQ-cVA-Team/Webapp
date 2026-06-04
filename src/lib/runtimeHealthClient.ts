export type RuntimeHealthStatus = "up" | "degraded" | "down" | "misconfigured" | "unknown";

export type RuntimeServiceHealthItem = {
  key: string;
  label: string;
  status: RuntimeHealthStatus;
  detail: string;
  httpStatus?: number;
  latencyMs?: number;
  checkedAt: string;
};

export type RuntimeConfigHealthItem = {
  key: string;
  status: "ok" | "warning" | "error";
  detail: string;
};

export type RuntimeExternalHealthItem = {
  key: string;
  label: string;
  status: RuntimeHealthStatus;
  detail: string;
  httpStatus?: number;
  latencyMs?: number;
  checkedAt: string;
};

export type RuntimeHealthResponse = {
  checkedAt: string;
  overall: RuntimeHealthStatus;
  visibility: "full" | "limited";
  services: RuntimeServiceHealthItem[];
  config: RuntimeConfigHealthItem[];
  external: RuntimeExternalHealthItem[];
};

const HEALTH_TTL_MS = 10_000;

let cachedValue: RuntimeHealthResponse | null = null;
let cachedAt = 0;
let inflightPromise: Promise<RuntimeHealthResponse> | null = null;

export async function getRuntimeHealthCached(forceRefresh = false): Promise<RuntimeHealthResponse> {
  const now = Date.now();
  const cacheFresh = now - cachedAt < HEALTH_TTL_MS;

  if (!forceRefresh && cachedValue && cacheFresh) {
    return cachedValue;
  }

  if (!forceRefresh && inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = fetch("/api/runtime-health", {
    method: "GET",
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load service health (${response.status})`);
      }

      const payload = (await response.json()) as RuntimeHealthResponse;
      cachedValue = payload;
      cachedAt = Date.now();
      return payload;
    })
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}
