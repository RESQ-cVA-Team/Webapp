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

export type AngelsAwardsThreshold =
  | number
  | { lt: number }
  | { gt: number };
export type AngelsAwardsThresholds = Record<
  string,
  Record<string, AngelsAwardsThreshold>
>;

export interface ChartMetadata {
  title: string;
  description?: string;
  x_axis?: ChartAxis;
  y_axis?: ChartAxis;
  legend?: boolean;
  width?: number;
  height?: number;
  angels_awards?: AngelsAwardsThresholds;
}
