import type { ChartMetadata, ChartSeries, ChartType } from "./types";

export interface LineChartDTO {
  type: Extract<ChartType, "LINE">;
  metadata: ChartMetadata;
  series: ChartSeries[];
  smooth?: boolean;
  show_points?: boolean;
  fill_area?: boolean;
}

export interface AreaChartDTO {
  type: Extract<ChartType, "AREA">;
  metadata: ChartMetadata;
  series: ChartSeries[];
  stacked?: boolean;
  normalize?: boolean;
  transparency?: number;
}

export interface BarChartDTO {
  type: Extract<ChartType, "BAR">;
  metadata: ChartMetadata;
  series: ChartSeries[];
  orientation?: "vertical" | "horizontal";
  stacked?: boolean;
  bar_width?: number;
}

export interface PieSliceDTO { label: string; value: number; color?: string }
export interface PieChartDTO {
  type: Extract<ChartType, "PIE">;
  metadata: ChartMetadata;
  data: PieSliceDTO[];
  show_percentages?: boolean;
  donut?: boolean;
  inner_radius?: number;
}

export interface RadarChartDTO {
  type: Extract<ChartType, "RADAR">;
  metadata: ChartMetadata;
  series: ChartSeries[];
  axes: string[];
  scale_min?: number;
  scale_max?: number;
  filled?: boolean;
}

export interface ScatterChartDTO {
  type: Extract<ChartType, "SCATTER">;
  metadata: ChartMetadata;
  series: ChartSeries[];
  point_size?: number;
  show_trend_line?: boolean;
  bubble_size_field?: string;
}

export interface HistogramBinDTO {
  range_start: number;
  range_end: number;
  frequency: number;
  density?: number;
  label?: string;
}
export interface HistogramChartDTO {
  type: Extract<ChartType, "HISTOGRAM">;
  metadata: ChartMetadata;
  data: HistogramBinDTO[];
  bin_count: number;
  bin_width?: number;
  cumulative?: boolean;
}

export interface BoxEntryDTO {
  name: string;
  q1: number;
  median: number;
  q3: number;
  min: number;
  max: number;
  outliers?: number[] | null;
}
export interface BoxChartDTO {
  type: Extract<ChartType, "BOX">;
  metadata: ChartMetadata;
  data: BoxEntryDTO[];
  show_outliers?: boolean;
  notched?: boolean;
}

export interface WaterfallStepDTO {
  label: string;
  value: number;
  is_total?: boolean;
  is_positive?: boolean;
}
export interface WaterfallChartDTO {
  type: Extract<ChartType, "WATERFALL">;
  metadata: ChartMetadata;
  data: WaterfallStepDTO[];
  show_connectors?: boolean;
  start_value?: number;
}

export type ChartDTO =
  | LineChartDTO
  | AreaChartDTO
  | BarChartDTO
  | PieChartDTO
  | RadarChartDTO
  | ScatterChartDTO
  | HistogramChartDTO
  | BoxChartDTO
  | WaterfallChartDTO;
