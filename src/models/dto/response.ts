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
}

export interface VisualizationPlanPredicateFilterDTO {
  op: "predicate";
  field: string;
  operator: string;
  value?: string | number | boolean;
  values?: Array<string | number | boolean>;
}

export interface VisualizationPlanNotFilterDTO {
  op: "not";
  clause: VisualizationPlanFilterNodeDTO;
}

export interface VisualizationPlanAndFilterDTO {
  op: "and";
  clauses: VisualizationPlanFilterNodeDTO[];
}

export interface VisualizationPlanOrFilterDTO {
  op: "or";
  clauses: VisualizationPlanFilterNodeDTO[];
}

export type VisualizationPlanFilterNodeDTO =
  | VisualizationPlanPredicateFilterDTO
  | VisualizationPlanNotFilterDTO
  | VisualizationPlanAndFilterDTO
  | VisualizationPlanOrFilterDTO;

export interface VisualizationPlanTimeXAxisDTO {
  kind: "time";
  grain: string;
  window?: Record<string, unknown>;
  includePartial?: boolean;
}

export interface VisualizationPlanCategoryXAxisDTO {
  kind: "category";
  groupBy: Record<string, unknown>;
  order?: string;
}

export interface VisualizationPlanNumericMetricXAxisDTO {
  kind: "numeric_metric";
  metric: string;
  bins?: number;
  minValue?: number;
  maxValue?: number;
}

export type VisualizationPlanXAxisDTO =
  | VisualizationPlanTimeXAxisDTO
  | VisualizationPlanCategoryXAxisDTO
  | VisualizationPlanNumericMetricXAxisDTO;

export interface VisualizationPlanMetricValueAxisDTO {
  kind: "metric_value";
  statistic?: string;
  unit?: string;
}

export interface VisualizationPlanCountAxisDTO {
  kind: "count";
}

export type VisualizationPlanYAxisDTO =
  | VisualizationPlanMetricValueAxisDTO
  | VisualizationPlanCountAxisDTO;

export interface VisualizationPlanLineSeriesDTO {
  metric: string;
  xAxis: string;
  yAxis: string;
  label?: string;
  filters?: VisualizationPlanFilterNodeDTO;
  dataOrigin?: Record<string, unknown>;
  originScope?: Record<string, unknown>;
}

export interface VisualizationPlanLineChartDTO {
  title?: string;
  chartType: "LINE";
  xAxes: Record<string, VisualizationPlanXAxisDTO>;
  yAxes: Record<string, VisualizationPlanYAxisDTO>;
  series: VisualizationPlanLineSeriesDTO[];
  filters?: VisualizationPlanFilterNodeDTO;
}

export interface VisualizationPlanHistogramChartDTO {
  title?: string;
  chartType: "HISTOGRAM";
  xAxis: VisualizationPlanNumericMetricXAxisDTO;
  yAxis: VisualizationPlanCountAxisDTO;
  filters?: VisualizationPlanFilterNodeDTO;
  dataOrigin?: Record<string, unknown>;
  originScope?: Record<string, unknown>;
}

export type VisualizationPlanChartDTO =
  | VisualizationPlanLineChartDTO
  | VisualizationPlanHistogramChartDTO;

export interface VisualizationPlanStatisticalTestDTO {
  test_type: string;
  metrics: VisualizationPlanMetricDTO[];
  group_by?: Array<Record<string, unknown>>;
  filters?: VisualizationPlanFilterNodeDTO;
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
  schemaVersion: 2;
  charts?: VisualizationPlanChartDTO[];
  statisticalTests?: VisualizationPlanStatisticalTestDTO[];
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
