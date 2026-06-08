import { NextRequest, NextResponse } from "next/server";
import { getUserAccessToken, inspectUserAccessTokenLookup } from "@/lib/userTokenVault";
import {
  createTraceLogContext,
  readTraceId,
  TRACE_ID_HEADER,
  withTraceIdHeaders,
} from "@/lib/traceId";

const FETCH_TIMEOUT_MS = Number(process.env.RASA_PROXY_TIMEOUT_MS ?? 60000);
const ACTION_SERVER_TOKEN = process.env.ACTION_SERVER_TOKEN;

type ProxyRequestBody = {
  senderId?: unknown;
  target?: unknown;
  request?: {
    path: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    query?: Record<string, string | number | boolean>;
    body?: unknown;
  };
};

type ProxyErrorDetails = {
  traceId: string | null;
  target?: string | null;
  method?: string | null;
  path?: string | null;
  upstreamUrl?: string | null;
  upstreamStatus?: number | null;
  upstreamContentType?: string | null;
  reason?: string | null;
  tokenLookup?: {
    requestedKey: string;
    requestedKeyFormat: string;
    fallbackKey: string | null;
    exactMatch: boolean;
    fallbackMatch: boolean;
    exactExpiresAt: number | null;
    fallbackExpiresAt: number | null;
    storage: string;
  };
};

function getAllowedTargets(): Record<string, string> {
  const raw = process.env.RASA_PROXY_TARGETS;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};

    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === "string" && typeof value === "string" && value.trim()) {
        safe[key.trim()] = value.trim();
      }
    }
    return safe;
  } catch {
    return {};
  }
}

function joinTargetUrl(baseUrl: string, path: string, query?: Record<string, string | number | boolean>): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${normalizedPath}`);

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (!key) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function buildProxyResponseHeaders(traceId: string | null, headers?: HeadersInit): Headers {
  return withTraceIdHeaders(
    {
      "Cache-Control": "no-store",
      ...headers,
    },
    traceId
  );
}

function buildProxyErrorBody(message: string, details: ProxyErrorDetails) {
  return {
    message,
    proxy: {
      traceId: details.traceId,
      target: details.target ?? null,
      method: details.method ?? null,
      path: details.path ?? null,
      upstreamUrl: details.upstreamUrl ?? null,
      upstreamStatus: details.upstreamStatus ?? null,
      upstreamContentType: details.upstreamContentType ?? null,
      reason: details.reason ?? null,
      tokenLookup: details.tokenLookup ?? null,
    },
  };
}

function createProxyErrorResponse(
  message: string,
  status: number,
  details: ProxyErrorDetails
): NextResponse {
  return NextResponse.json(buildProxyErrorBody(message, details), {
    status,
    headers: buildProxyResponseHeaders(details.traceId),
  });
}

function summarizeUpstreamBody(body: string, contentType: string | null): unknown {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }

  if (contentType?.toLowerCase().includes("application/json")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(0, 2000);
    }
  }

  return trimmed.slice(0, 2000);
}

function createUpstreamFailureResponse(params: {
  traceId: string | null;
  status: number;
  target: string;
  method: string;
  path: string;
  upstreamUrl: string;
  upstreamContentType: string | null;
  upstreamBody: string;
}): NextResponse {
  const upstreamBodySummary = summarizeUpstreamBody(params.upstreamBody, params.upstreamContentType);

  return NextResponse.json(
    {
      message: `Proxy request failed with upstream status ${params.status}`,
      proxy: {
        traceId: params.traceId,
        target: params.target,
        method: params.method,
        path: params.path,
        upstreamUrl: params.upstreamUrl,
        upstreamStatus: params.status,
        upstreamContentType: params.upstreamContentType,
      },
      upstream: {
        body: upstreamBodySummary,
      },
    },
    {
      status: params.status,
      headers: buildProxyResponseHeaders(params.traceId),
    }
  );
}

export async function POST(req: NextRequest) {
  const traceId = readTraceId(req.headers);

  if (!ACTION_SERVER_TOKEN) {
    console.error(
      "[rasa-proxy] Missing ACTION_SERVER_TOKEN environment variable",
      createTraceLogContext(traceId)
    );
    return createProxyErrorResponse("Server misconfiguration", 500, {
      traceId,
      reason: "ACTION_SERVER_TOKEN is not configured",
    });
  }

  const serviceToken = req.headers.get("x-action-server-token");
  if (!serviceToken || serviceToken !== ACTION_SERVER_TOKEN) {
    console.warn("[rasa-proxy] Unauthorized request", createTraceLogContext(traceId));
    return createProxyErrorResponse("Unauthorized", 401, {
      traceId,
      reason: "Missing or invalid x-action-server-token",
    });
  }

  let body: ProxyRequestBody;
  try {
    body = (await req.json()) as ProxyRequestBody;
  } catch {
    console.warn("[rasa-proxy] Invalid JSON body", createTraceLogContext(traceId));
    return createProxyErrorResponse("Invalid JSON body", 400, {
      traceId,
      reason: "Request body could not be parsed as JSON",
    });
  }

  const senderId = typeof body?.senderId === "string" ? body.senderId.trim() : null;
  const target = typeof body?.target === "string" ? body.target.trim() : null;
  const request = body?.request;
  if (!senderId || !target || !request?.path) {
    console.warn("[rasa-proxy] Invalid proxy request", createTraceLogContext(traceId, {
      target,
      path: request?.path,
      senderId,
    }));
    return createProxyErrorResponse("Invalid proxy request", 400, {
      traceId,
      target,
      path: request?.path ?? null,
      reason: "senderId, target, and request.path are required",
    });
  }

  const userAccessToken = getUserAccessToken(senderId);
  if (!userAccessToken) {
    const tokenLookup = inspectUserAccessTokenLookup(senderId);
    console.warn("[rasa-proxy] User token unavailable", createTraceLogContext(traceId, {
      senderId,
      tokenLookup,
    }));
    return createProxyErrorResponse("User token unavailable", 401, {
      traceId,
      target,
      path: request.path,
      reason: "No cached user access token was found for senderId",
      tokenLookup,
    });
  }

  const targets = getAllowedTargets();
  const baseUrl = targets[target];
  if (!baseUrl) {
    console.warn("[rasa-proxy] Unknown proxy target", createTraceLogContext(traceId, { target }));
    return createProxyErrorResponse("Unknown proxy target", 403, {
      traceId,
      target,
      path: request.path,
      reason: "Target is not configured in RASA_PROXY_TARGETS",
    });
  }

  const method = (request.method ?? "POST").toUpperCase();
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  if (!allowedMethods.has(method)) {
    console.warn("[rasa-proxy] Unsupported HTTP method", createTraceLogContext(traceId, {
      method,
      target,
      path: request.path,
    }));
    return createProxyErrorResponse("Unsupported HTTP method", 400, {
      traceId,
      target,
      method,
      path: request.path,
      reason: "Supported methods are GET, POST, PUT, PATCH, DELETE",
    });
  }

  const url = joinTargetUrl(baseUrl, request.path, request.query);
  console.info("[rasa-proxy] Forwarding upstream request", createTraceLogContext(traceId, {
    target,
    method,
    path: request.path,
    url,
    senderId,
  }));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const outgoingHeaders = withTraceIdHeaders({
    Authorization: `Bearer ${userAccessToken}`,
    "Content-Type": "application/json",
  }, traceId);

  if (request.headers && typeof request.headers === "object") {
    for (const [key, value] of Object.entries(request.headers)) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey === "authorization" ||
        normalizedKey === "cookie" ||
        normalizedKey === TRACE_ID_HEADER
      ) {
        continue;
      }
      outgoingHeaders.set(key, value);
    }
  }

  const hasBody = method !== "GET" && method !== "DELETE";
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: outgoingHeaders,
      body: hasBody ? JSON.stringify(request.body ?? {}) : undefined,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === "AbortError") {
      console.error("[rasa-proxy] Upstream request timed out", createTraceLogContext(traceId, {
        target,
        method,
        url,
        timeoutMs: FETCH_TIMEOUT_MS,
      }));
      return createProxyErrorResponse("Upstream timeout", 504, {
        traceId,
        target,
        method,
        path: request.path,
        upstreamUrl: url,
        reason: `Upstream request exceeded ${FETCH_TIMEOUT_MS}ms timeout`,
      });
    }

    console.error("[rasa-proxy] Upstream request failed", createTraceLogContext(traceId, {
      target,
      method,
      url,
      error: err instanceof Error ? err.message : String(err),
    }));
    return createProxyErrorResponse("Upstream request failed", 502, {
      traceId,
      target,
      method,
      path: request.path,
      upstreamUrl: url,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  clearTimeout(timeoutId);
  console.info("[rasa-proxy] Upstream response received", createTraceLogContext(traceId, {
    target,
    method,
    url,
    status: res.status,
  }));

  const responseText = await res.text();

  if (!res.ok) {
    console.warn("[rasa-proxy] Returning upstream error response", createTraceLogContext(traceId, {
      target,
      method,
      path: request.path,
      url,
      status: res.status,
      upstreamContentType: res.headers.get("content-type"),
      upstreamBodyPreview: responseText.slice(0, 500),
    }));

    return createUpstreamFailureResponse({
      traceId,
      status: res.status,
      target,
      method,
      path: request.path,
      upstreamUrl: url,
      upstreamContentType: res.headers.get("content-type"),
      upstreamBody: responseText,
    });
  }

  return new NextResponse(responseText, {
    status: res.status,
    headers: buildProxyResponseHeaders(traceId, {
      "Content-Type": res.headers.get("content-type") ?? "application/json; charset=utf-8",
    }),
  });
}
