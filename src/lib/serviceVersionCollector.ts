import { withRasaAuth } from "@/lib/rasaConfig";

type ServiceName = "webapp" | "rasa" | "action" | "ssot";

export type CollectedServiceSnapshot = {
  service: ServiceName;
  version?: string | null;
  commitSha?: string | null;
  imageTag?: string | null;
  modelName?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ServiceConfig = {
  service: ServiceName;
  envPrefix: string;
  versionUrlEnv: string;
};

const SERVICE_CONFIGS: ServiceConfig[] = [
  { service: "webapp", envPrefix: "WEBAPP", versionUrlEnv: "WEBAPP_VERSION_URL" },
  { service: "rasa", envPrefix: "RASA", versionUrlEnv: "RASA_VERSION_URL" },
  { service: "action", envPrefix: "ACTION", versionUrlEnv: "ACTION_VERSION_URL" },
  { service: "ssot", envPrefix: "SSOT", versionUrlEnv: "SSOT_VERSION_URL" },
];

function readEnvValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function extractString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = payload[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function mergeMetadata(
  base: CollectedServiceSnapshot,
  payload: Record<string, unknown> | null
): CollectedServiceSnapshot {
  if (!payload) {
    return base;
  }

  return {
    service: base.service,
    version: extractString(payload, ["version", "serviceVersion", "appVersion"]) ?? base.version ?? null,
    commitSha: extractString(payload, ["commitSha", "gitSha", "commit", "revision"]) ?? base.commitSha ?? null,
    imageTag: extractString(payload, ["imageTag", "image", "containerTag"]) ?? base.imageTag ?? null,
    modelName:
      extractString(payload, ["modelName", "llmModel", "defaultModel"]) ?? base.modelName ?? null,
    metadata: payload,
  };
}

function getEnvSnapshot(config: ServiceConfig): CollectedServiceSnapshot | null {
  const version = readEnvValue(`${config.envPrefix}_VERSION`);
  const commitSha = readEnvValue(`${config.envPrefix}_COMMIT_SHA`);
  const imageTag = readEnvValue(`${config.envPrefix}_IMAGE_TAG`);
  const modelName = readEnvValue(`${config.envPrefix}_MODEL_NAME`) ?? readEnvValue(`${config.envPrefix}_LLM_MODEL`);

  if (!version && !commitSha && !imageTag && !modelName) {
    return null;
  }

  return {
    service: config.service,
    version,
    commitSha,
    imageTag,
    modelName,
    metadata: null,
  };
}

async function fetchVersionPayload(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`Version endpoint at ${url} returned non-OK status`, { status: response.status, statusText: response.statusText });
      return { status: response.status, statusText: response.statusText };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      console.warn(`Version endpoint at ${url} did not return JSON`, { contentType });
      return { warning: "non-json-version-response", contentType };
    }

    const payload = (await response.json()) as unknown;
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : { value: payload };
  } catch (error) {
    console.error(`Error fetching version from ${url}:`, error instanceof Error ? error.message : error);
    return {
      error: error instanceof Error ? error.message : "version-fetch-failed",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function collectFeedbackServiceSnapshots(): Promise<CollectedServiceSnapshot[]> {
  const snapshots: CollectedServiceSnapshot[] = [];

  for (const config of SERVICE_CONFIGS) {
    const envSnapshot = getEnvSnapshot(config) ?? { service: config.service };
    const versionUrl = readEnvValue(config.versionUrlEnv);

    if (!versionUrl) {
      if (envSnapshot.version || envSnapshot.commitSha || envSnapshot.imageTag || envSnapshot.modelName) {
        snapshots.push(envSnapshot);
      }
      continue;
    }

    const resolvedVersionUrl = config.service === "rasa" ? withRasaAuth(versionUrl) : versionUrl;
    const payload = await fetchVersionPayload(resolvedVersionUrl);
    snapshots.push(mergeMetadata(envSnapshot, payload));
  }

  return snapshots;
}