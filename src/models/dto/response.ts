import type { ChartDTO } from "./charts";

export interface StatisticalTestResultDTO {
  test_type: string;
  status: "success" | "skipped" | "error";
  reason?: string;
  p_value?: number;
  effect_size?: number;
  significance_level?: number;
  passed?: boolean | null;
  details?: Record<string, unknown> | null;
  title?: string;
  description?: string;
}

export interface VisualizationPlanMetricDTO {
  title?: string;
  description?: string;
  metric: string;
  distribution?: Record<string, unknown> | null;
}

export interface VisualizationPlanChartDTO {
  title?: string;
  description?: string;
  chart_type?: string;
  filters?: Record<string, unknown> | null;
  group_by?: Array<Record<string, unknown>>;
  metrics?: VisualizationPlanMetricDTO[];
}

export interface VisualizationPlanStatisticalTestDTO {
  title?: string;
  description?: string;
  test_type?: string;
  metrics?: VisualizationPlanMetricDTO[];
  group_by?: Array<Record<string, unknown>>;
  filters?: Record<string, unknown> | null;
}

export interface VisualizationPlanMetadataDTO {
  trace_id?: string;
  planner_provider?: string;
  planner_model?: string;
  planner_version?: string;
  request_mode?: string;
  requested_visual_layout?: string;
  data_origin_override?: Record<string, unknown> | null;
  fallback_used?: boolean;
  fallback_reason?: string | null;
  generated_at_utc?: string;
  [key: string]: unknown;
}

export interface VisualizationPlanDTO {
  charts?: VisualizationPlanChartDTO[];
  statistical_tests?: VisualizationPlanStatisticalTestDTO[];
  metadata?: VisualizationPlanMetadataDTO;
}

export interface VisualizationPlanMessageDTO {
  type: "visualization_plan";
  trace_id?: string;
  plan: VisualizationPlanDTO;
}

export interface VisualizationResponseDTO {
  schema_version: 1;
  trace_id?: string;
  charts?: ChartDTO[];
  stats?: StatisticalTestResultDTO[];
  timestamp?: string; // ISO timestamp
}

export function isVisualizationPlanMessageDTO(value: unknown): value is VisualizationPlanMessageDTO {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return candidate.type === "visualization_plan" && !!candidate.plan && typeof candidate.plan === "object";
}

export function isVisualizationResponseDTO(value: unknown): value is VisualizationResponseDTO {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return (
    candidate.schema_version === 1 &&
    (Array.isArray(candidate.charts) || Array.isArray(candidate.stats))
  );
}

export function resolveVisualizationTraceId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    trace_id?: unknown;
    plan?: {
      metadata?: {
        trace_id?: unknown;
      };
    };
  };

  if (typeof candidate.trace_id === "string" && candidate.trace_id.trim()) {
    return candidate.trace_id;
  }

  if (typeof candidate.plan?.metadata?.trace_id === "string" && candidate.plan.metadata.trace_id.trim()) {
    return candidate.plan.metadata.trace_id;
  }

  return null;
}
