// Health of the services outside this stack (aggregation, analytics, Keycloak).
// Probed through public endpoints without a user token, and shared by every
// caller for UPSTREAM_HEALTH_TTL_MS: any number of open sessions makes one
// probe per period, and none of them shows up as a user's query upstream.

export type UpstreamHealthStatus = "up" | "degraded" | "down" | "misconfigured" | "unknown";

export type UpstreamHealthItem = {
  key: string;
  label: string;
  status: UpstreamHealthStatus;
  detail: string;
  httpStatus?: number;
  latencyMs?: number;
  checkedAt: string;
};

export const UPSTREAM_HEALTH_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 2500;
const SLOW_MS = 2000;

let shared: { at: number; items: Promise<UpstreamHealthItem[]> } | null = null;

/** The latest probe results while they are fresh, else one new probe that concurrent callers share. */
export function sharedUpstreamHealth(probe: () => Promise<UpstreamHealthItem[]>, now: number = Date.now()): Promise<UpstreamHealthItem[]> {
  if (shared && now - shared.at < UPSTREAM_HEALTH_TTL_MS) return shared.items;
  const items = probe();
  shared = { at: now, items };
  return items;
}

export function resetUpstreamHealthCache(): void {
  shared = null;
}

function classifyHttpStatus(status: number): UpstreamHealthStatus {
  if (status === 401 || status === 403) return "misconfigured";
  if (status >= 500) return "down";
  if (status >= 400) return "degraded";
  return "up";
}

async function probe(
  params: { key: string; label: string; url: string | null },
  judge: (response: Response) => Promise<{ status: UpstreamHealthStatus; detail: string }>,
): Promise<UpstreamHealthItem> {
  const checkedAt = new Date().toISOString();
  if (!params.url) {
    return { key: params.key, label: params.label, status: "misconfigured", detail: "Endpoint URL is not configured", checkedAt };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(params.url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { key: params.key, label: params.label, status: classifyHttpStatus(response.status), detail: `Endpoint returned ${response.status}`, httpStatus: response.status, latencyMs, checkedAt };
    }
    const verdict = await judge(response);
    const slow = verdict.status === "up" && latencyMs > SLOW_MS;
    return {
      key: params.key,
      label: params.label,
      status: slow ? "degraded" : verdict.status,
      detail: slow ? `${verdict.detail}, but slow` : verdict.detail,
      httpStatus: response.status,
      latencyMs,
      checkedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { key: params.key, label: params.label, status: "down", detail: `Probe failed: ${message}`, latencyMs: Date.now() - started, checkedAt };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** A service's public liveness endpoint, which answers {"status": "UP", "meta": {"commit": ...}} when it is live. */
export function probeLiveness(params: { key: string; label: string; url: string | null }): Promise<UpstreamHealthItem> {
  return probe(params, async (response) => {
    const body = (await response.json().catch(() => null)) as { status?: unknown; meta?: { commit?: unknown } } | null;
    const commit = typeof body?.meta?.commit === "string" ? ` (commit ${body.meta.commit.slice(0, 7)})` : "";
    return body?.status === "UP"
      ? { status: "up", detail: `Live${commit}` }
      : { status: "down", detail: `Liveness reports ${String(body?.status ?? "no status")}` };
  });
}

/** A public endpoint that only needs to answer. */
export function probePublicGet(params: { key: string; label: string; url: string | null }): Promise<UpstreamHealthItem> {
  return probe(params, async () => ({ status: "up", detail: "Endpoint reachable" }));
}
