import type { AngelsAwardsThresholds, ChartSeries } from "@/models/dto/types";

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


export function getPointLabelMap(series: ChartSeries[]) {
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

export interface AngelsAwardsZone {
  from: number;
  to?: number;
  label: string;
  color: string;
}

interface ParsedAngelsAwardsThreshold {
  tier: string;
  value: number;
  operator: "lt" | "gt" | "gte";
}

export function getAngelsAwardsZones(
  thresholdsByMetric?: AngelsAwardsThresholds,
) {
  const tierColors: Record<string, string> = {
    gold: "var(--aa-gold)",
    platinum: "var(--aa-platinum)",
    diamond: "var(--aa-diamond)",
  };

  return Object.entries(thresholdsByMetric ?? {}).flatMap(([metric, thresholds]) => {
    const parsedTiers: ParsedAngelsAwardsThreshold[] = Object.entries(thresholds).map(
      ([tier, threshold]) => {
        if (typeof threshold === "number") {
          return { tier, value: threshold, operator: "gte" };
        }

        if ("lt" in threshold) {
          return { tier, value: threshold.lt, operator: "lt" };
        }

        return { tier, value: threshold.gt, operator: "gt" };
      },
    );
    const diamondThreshold = parsedTiers.find(
      ({ tier }) => tier.toLowerCase() === "diamond",
    );
    const tiers = parsedTiers.filter(
      ({ tier, value, operator }) =>
        tier.toLowerCase() !== "platinum" ||
        value !== diamondThreshold?.value ||
        operator !== diamondThreshold?.operator,
    );
    const lowerBoundTiers = tiers
      .filter(({ operator }) => operator !== "lt")
      .sort((a, b) => a.value - b.value);

    return tiers.map(({ tier, value, operator }) => {
      const nextThreshold = operator === "lt"
        ? undefined
        : lowerBoundTiers.find(
            (candidate) => candidate.value > value,
          )?.value;
      const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
      const operatorLabel = operator === "lt" ? "<" : operator === "gt" ? ">" : "≥";
      const thresholdLabel =
        metric.toUpperCase() === "AA_STROKE_UNIT" && operator === "gt" && value === 0
          ? "YES"
          : `${operatorLabel} ${value}`;

      return {
        from: operator === "lt" ? 0 : value,
        to: operator === "lt" ? value : nextThreshold,
        label: `${tierName} (${thresholdLabel})`,
        color: tierColors[tier.toLowerCase()] ?? "var(--foreground)",
      };
    });
  });
}

