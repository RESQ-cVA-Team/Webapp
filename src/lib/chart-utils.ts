import type { ChartSeries } from "@/models/dto/types";

export type ChartPointValue = number | string | null;

const SERIES_HUES = [210, 20, 135, 280, 0, 180, 45, 320, 95, 250, 160, 10];

interface DynamicCategoryTickLayoutInput {
  chartWidthPx: number;
  pointCount: number;
  rotateThresholdPx?: number;
  horizontalMinTickSpacingPx?: number;
  rotatedMinTickSpacingPx?: number;
  rotatedAngle?: number;
  labelHeightBig?: number;
  labelHeightSmall?: number;
}

interface DynamicCategoryTickLayout {
  angle: number;
  interval: number;
  textAnchor: "middle" | "end";
  height: number;
}

export function getDynamicCategoryTickLayout({
  chartWidthPx,
  pointCount,
  rotateThresholdPx = 70,
  horizontalMinTickSpacingPx = 10,
  rotatedMinTickSpacingPx = 30,
  rotatedAngle = -45,
  labelHeightBig = 50,
  labelHeightSmall = 40,
}: DynamicCategoryTickLayoutInput): DynamicCategoryTickLayout {
  const safePointCount = Math.max(1, pointCount);
  const safeChartWidthPx = Math.max(1, chartWidthPx);
  const pixelsPerPoint = safeChartWidthPx / safePointCount;
  const angle = pixelsPerPoint < rotateThresholdPx ? rotatedAngle : 0;
  const minTickSpacingPx = angle === 0 ? horizontalMinTickSpacingPx : rotatedMinTickSpacingPx;
  const showEveryNPoints = Math.max(1, Math.ceil(minTickSpacingPx / pixelsPerPoint));

  return {
    angle,
    interval: showEveryNPoints - 1,
    textAnchor: angle === 0 ? "middle" : "end",
    height: angle === 0 ? labelHeightSmall : labelHeightBig,
  };
}

export function getPointLabelMap(series: Pick<ChartSeries, "data">[]) {
  const labelMap = new Map<string, string>();

  for (const currentSeries of series) {
    for (const point of currentSeries.data) {
      if (point.label) {
        labelMap.set(String(point.x), point.label);
      }
    }
  }

  return labelMap;
}

export function buildNumericBucketLabel(
  bin: string | number,
  index: number,
  bins: (string | number)[],
  preferredLabel?: string,
) {
  if (preferredLabel) {
    return preferredLabel;
  }

  if (typeof bin === "number") {
    const nextBin = bins[index + 1];
    if (typeof nextBin === "number") {
      return `${bin}-${nextBin}`;
    }

    const previousBin = bins[index - 1];
    if (typeof previousBin === "number") {
      const step = bin - previousBin;
      return `${bin}-${bin + step}`;
    }
  }

  return String(bin);
}

export function getSeriesColor(index: number) {
  const safeIndex = Math.max(0, Math.floor(index));
  const hue = SERIES_HUES[safeIndex % SERIES_HUES.length];
  const cycle = Math.floor(safeIndex / SERIES_HUES.length);
  const saturationByCycle = [72, 62, 78];
  const lightnessByCycle = [50, 44, 58];
  const saturation = saturationByCycle[cycle % saturationByCycle.length];
  const lightness = lightnessByCycle[cycle % lightnessByCycle.length];

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}