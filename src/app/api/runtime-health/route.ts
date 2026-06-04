import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFeedbackIdentityFromSession } from "@/lib/feedbackAccess";
import { getRasaBots, withRasaAuth } from "@/lib/rasaConfig";

type HealthStatus = "up" | "degraded" | "down" | "misconfigured" | "unknown";

type ServiceHealthItem = {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
  httpStatus?: number;
  latencyMs?: number;
  checkedAt: string;
};

type ConfigHealthItem = {
  key: string;
  status: "ok" | "warning" | "error";
  detail: string;
};

type ExternalHealthItem = {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
  httpStatus?: number;
  latencyMs?: number;
  checkedAt: string;
};

type RuntimeHealthResponse = {
  checkedAt: string;
  overall: HealthStatus;
  visibility: "full" | "limited";
  services: ServiceHealthItem[];
  config: ConfigHealthItem[];
  external: ExternalHealthItem[];
};

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseProxyTargets(): Record<string, string> {
  const raw = readEnv("RASA_PROXY_TARGETS");
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};

    const targets: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === "string" && typeof value === "string" && value.trim()) {
        targets[key.trim()] = value.trim();
      }
    }
    return targets;
  } catch {
    return {};
  }
}

function getWebappVersionUrl(): string {
  const configured = readEnv("WEBAPP_VERSION_URL");
  if (configured) return configured;
  const port = readEnv("PORT") ?? "3000";
  return `http://127.0.0.1:${port}/version`;
}

type RasaVersionTarget = {
  key: string;
  label: string;
  url: string;
};

function getRasaVersionTargets(): RasaVersionTarget[] {
  const configured = readEnv("RASA_VERSION_URL");
  if (configured) {
    return [
      {
        key: "rasa",
        label: "Rasa",
        url: withRasaAuth(configured),
      },
    ];
  }

  const bots = getRasaBots();
  if (bots.length === 0) {
    return [];
  }

  return bots.map((bot) => ({
    key: `rasa:${bot.lang}`,
    label: `Rasa (${bot.lang})`,
    url: withRasaAuth(`${bot.url.replace(/\/$/, "")}/version`),
  }));
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function resolveGraphqlUrl(): string | null {
  const targets = parseProxyTargets();
  const base = targets.graphql;
  if (!base) return null;
  return joinUrl(base, "/api/graphql/aggregation");
}

function resolveAnalyticsUrl(): string | null {
  const targets = parseProxyTargets();
  const base = targets.analytics;
  if (!base) return null;
  return joinUrl(base, "/api/rest/analytics-center/countries?limit=1&offset=0");
}

function resolveCvaThreadsUrl(): string | null {
  const base = readEnv("CVA_BASE_URL");
  if (!base) return null;
  return joinUrl(base, "/threads?limit=1");
}

function resolveKeycloakDiscoveryUrl(): string | null {
  const issuer = readEnv("KEYCLOAK_ISSUER");
  if (!issuer) return null;
  return joinUrl(issuer, "/.well-known/openid-configuration");
}

function classifyHttpStatus(status: number): HealthStatus {
  if (status === 401 || status === 403) return "misconfigured";
  if (status >= 500) return "down";
  if (status >= 400) return "degraded";
  return "up";
}

async function probeVersionEndpoint(params: {
  key: string;
  label: string;
  url: string | null;
}): Promise<ServiceHealthItem> {
  const checkedAt = new Date().toISOString();
  if (!params.url) {
    return {
      key: params.key,
      label: params.label,
      status: "misconfigured",
      detail: "Version URL is not configured",
      checkedAt,
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(params.url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      const detail = response.status === 401 || response.status === 403
        ? `Auth/config issue (${response.status})`
        : `Endpoint returned ${response.status}`;
      return {
        key: params.key,
        label: params.label,
        status: response.status === 401 || response.status === 403 ? "misconfigured" : "down",
        detail,
        httpStatus: response.status,
        latencyMs,
        checkedAt,
      };
    }

    if (!contentType.toLowerCase().includes("application/json")) {
      return {
        key: params.key,
        label: params.label,
        status: "degraded",
        detail: "Version endpoint returned non-JSON payload",
        httpStatus: response.status,
        latencyMs,
        checkedAt,
      };
    }

    return {
      key: params.key,
      label: params.label,
      status: latencyMs > 1500 ? "degraded" : "up",
      detail: latencyMs > 1500 ? "Service reachable but slow" : "Service reachable",
      httpStatus: response.status,
      latencyMs,
      checkedAt,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      key: params.key,
      label: params.label,
      status: "down",
      detail: `Probe failed: ${message}`,
      latencyMs,
      checkedAt,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeExternalGet(params: {
  key: string;
  label: string;
  url: string | null;
  accessToken?: string | null;
}): Promise<ExternalHealthItem> {
  const checkedAt = new Date().toISOString();
  if (!params.url) {
    return {
      key: params.key,
      label: params.label,
      status: "misconfigured",
      detail: "External endpoint URL is not configured",
      checkedAt,
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (params.accessToken) {
      headers.Authorization = `Bearer ${params.accessToken}`;
    }

    const response = await fetch(params.url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const status = classifyHttpStatus(response.status);

    return {
      key: params.key,
      label: params.label,
      status,
      detail: status === "up" ? "Endpoint reachable" : `Endpoint returned ${response.status}`,
      httpStatus: response.status,
      latencyMs,
      checkedAt,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      key: params.key,
      label: params.label,
      status: "down",
      detail: `Probe failed: ${message}`,
      latencyMs,
      checkedAt,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeExternalGraphql(params: {
  key: string;
  label: string;
  url: string | null;
  accessToken?: string | null;
}): Promise<ExternalHealthItem> {
  const checkedAt = new Date().toISOString();
  if (!params.url) {
    return {
      key: params.key,
      label: params.label,
      status: "misconfigured",
      detail: "GraphQL endpoint URL is not configured",
      checkedAt,
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (params.accessToken) {
      headers.Authorization = `Bearer ${params.accessToken}`;
    }

    const response = await fetch(params.url, {
      method: "POST",
      headers,
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({ query: "query { __typename }" }),
    });

    const latencyMs = Date.now() - started;
    const status = classifyHttpStatus(response.status);

    if (!response.ok) {
      return {
        key: params.key,
        label: params.label,
        status,
        detail: `GraphQL endpoint returned ${response.status}`,
        httpStatus: response.status,
        latencyMs,
        checkedAt,
      };
    }

    return {
      key: params.key,
      label: params.label,
      status: latencyMs > 2000 ? "degraded" : "up",
      detail: latencyMs > 2000 ? "GraphQL reachable but slow" : "GraphQL reachable",
      httpStatus: response.status,
      latencyMs,
      checkedAt,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      key: params.key,
      label: params.label,
      status: "down",
      detail: `Probe failed: ${message}`,
      latencyMs,
      checkedAt,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function collectConfigHealth(): ConfigHealthItem[] {
  const items: ConfigHealthItem[] = [];
  const proxyTargets = parseProxyTargets();

  const rasaUrlList = readEnv("RASA_URL_LIST");
  items.push({
    key: "rasa_url_list",
    status: rasaUrlList ? "ok" : "error",
    detail: rasaUrlList ? "RASA_URL_LIST configured" : "RASA_URL_LIST missing",
  });

  const rasaToken = readEnv("RASA_AUTH_TOKEN");
  items.push({
    key: "rasa_auth_token",
    status: rasaToken ? "ok" : "warning",
    detail: rasaToken ? "RASA auth token configured" : "RASA auth token missing",
  });

  const actionToken = readEnv("ACTION_SERVER_TOKEN");
  items.push({
    key: "action_server_token",
    status: actionToken ? "ok" : "error",
    detail: actionToken ? "Action proxy token configured" : "ACTION_SERVER_TOKEN missing",
  });

  items.push({
    key: "proxy_target_graphql",
    status: proxyTargets.graphql ? "ok" : "error",
    detail: proxyTargets.graphql ? "GraphQL proxy target configured" : "RASA_PROXY_TARGETS missing graphql",
  });

  items.push({
    key: "proxy_target_analytics",
    status: proxyTargets.analytics ? "ok" : "warning",
    detail: proxyTargets.analytics ? "Analytics proxy target configured" : "RASA_PROXY_TARGETS missing analytics",
  });

  const keycloakIssuer = readEnv("KEYCLOAK_ISSUER");
  const keycloakClientId = readEnv("KEYCLOAK_CLIENT_ID");
  items.push({
    key: "keycloak",
    status: keycloakIssuer && keycloakClientId ? "ok" : "warning",
    detail:
      keycloakIssuer && keycloakClientId
        ? "Keycloak auth configured"
        : "Keycloak issuer/client ID missing",
  });

  const cvaBaseUrl = readEnv("CVA_BASE_URL");
  items.push({
    key: "cva_base_url",
    status: cvaBaseUrl ? "ok" : "warning",
    detail: cvaBaseUrl ? "CVA base URL configured" : "CVA_BASE_URL not set (default fallback in use)",
  });

  return items;
}

function computeOverall(
  services: ServiceHealthItem[],
  config: ConfigHealthItem[],
  external: ExternalHealthItem[]
): HealthStatus {
  const hasServiceDown = services.some((item) => item.status === "down");
  const hasServiceMisconfigured = services.some((item) => item.status === "misconfigured");
  const hasConfigError = config.some((item) => item.status === "error");
  const hasExternalDown = external.some((item) => item.status === "down");
  const hasExternalMisconfigured = external.some((item) => item.status === "misconfigured");
  const hasDegraded = services.some((item) => item.status === "degraded");
  const hasExternalDegraded = external.some((item) => item.status === "degraded");
  const hasUnknown = services.some((item) => item.status === "unknown");
  const hasExternalUnknown = external.some((item) => item.status === "unknown");

  if (hasServiceDown || hasServiceMisconfigured || hasConfigError || hasExternalDown || hasExternalMisconfigured) return "down";
  if (hasDegraded || hasExternalDegraded) return "degraded";
  if (hasUnknown || hasExternalUnknown) return "unknown";
  return "up";
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const identity = getFeedbackIdentityFromSession(session);
  const isDevRuntime = process.env.NODE_ENV === "development";
  const canViewFullDiagnostics = isDevRuntime || identity.isAdmin;
  const accessToken = typeof session.accessToken === "string" ? session.accessToken : null;

  const rasaTargets = getRasaVersionTargets();
  const rasaChecks = rasaTargets.length > 0
    ? rasaTargets.map((target) =>
        probeVersionEndpoint({
          key: target.key,
          label: target.label,
          url: target.url,
        })
      )
    : [
        Promise.resolve<ServiceHealthItem>({
          key: "rasa",
          label: "Rasa",
          status: "misconfigured",
          detail: "No Rasa bot URL configured",
          checkedAt: new Date().toISOString(),
        }),
      ];

  const [webapp, action, upstreamGraphql, upstreamAnalytics, upstreamCva, keycloak, ...rasaResults] = await Promise.all([
    probeVersionEndpoint({ key: "webapp", label: "Webapp", url: getWebappVersionUrl() }),
    probeVersionEndpoint({ key: "action", label: "Action", url: readEnv("ACTION_VERSION_URL") }),
    probeExternalGraphql({
      key: "upstream_graphql",
      label: "Upstream GraphQL",
      url: resolveGraphqlUrl(),
      accessToken,
    }),
    probeExternalGet({
      key: "upstream_analytics",
      label: "Upstream Analytics REST",
      url: resolveAnalyticsUrl(),
      accessToken,
    }),
    probeExternalGet({
      key: "upstream_cva",
      label: "CVA API",
      url: resolveCvaThreadsUrl(),
      accessToken,
    }),
    probeExternalGet({
      key: "keycloak_discovery",
      label: "Keycloak Discovery",
      url: resolveKeycloakDiscoveryUrl(),
    }),
    ...rasaChecks,
  ]);

  const config = collectConfigHealth();
  const services = [webapp, ...rasaResults, action];
  const external = [upstreamGraphql, upstreamAnalytics, upstreamCva, keycloak];
  const overall = computeOverall(services, config, external);

  const responseBody: RuntimeHealthResponse = canViewFullDiagnostics
    ? {
        checkedAt: new Date().toISOString(),
        overall,
        visibility: "full",
        services,
        config,
        external,
      }
    : {
        checkedAt: new Date().toISOString(),
        overall,
        visibility: "limited",
        services: services.map((item) => ({
          key: item.key,
          label: item.label,
          status: item.status,
          detail: item.status === "up" ? "Service reachable" : "Service health issue detected",
          checkedAt: item.checkedAt,
        })),
        config: [],
        external: external.map((item) => ({
          key: item.key,
          label: item.label,
          status: item.status,
          detail: item.status === "up" ? "Endpoint reachable" : "Endpoint health issue detected",
          checkedAt: item.checkedAt,
        })),
      };

  return NextResponse.json(
    responseBody,
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
