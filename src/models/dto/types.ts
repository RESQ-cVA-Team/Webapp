// Kept in sync with SSOT/ChartType.yml's canonical values -- see
// tests/lib/chartType.test.ts, which fails if this list and that file
// diverge.
export const CHART_TYPES = [
  "LINE",
  "BAR",
  "BOX",
  "HISTOGRAM",
  "SCATTER",
  "PIE",
  "RADAR",
  "WATERFALL",
  "AREA",
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartPoint {
  x: string | number;
  y: number;
  label?: string;
}

export interface ChartSeries {
  name: string;
  data: ChartPoint[];
  color?: string;
  style?: Record<string, unknown>;
}

export type AxisType = "linear" | "logarithmic" | "category" | "time";

export interface ChartAxis {
  label: string;
  type?: AxisType;
  min_value?: number;
  max_value?: number;
  unit?: string;
}

export type AngelsAwardsLevel = "gold" | "platinum" | "diamond";
/** What an award level asks of a metric: a minimum share of cases, or a condition that must hold. */
export type AngelsAwardsRequirement = { min_percent: number } | { required: true };
export type AngelsAwardsRequirements = Record<
  string,
  Partial<Record<AngelsAwardsLevel, AngelsAwardsRequirement>>
>;

export interface ChartMetadata {
  title: string;
  description?: string;
  x_axis?: ChartAxis;
  y_axis?: ChartAxis;
  legend?: boolean;
  width?: number;
  height?: number;
  angels_awards?: AngelsAwardsRequirements;
}
