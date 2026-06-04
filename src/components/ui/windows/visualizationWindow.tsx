'use client';

import type { ReactElement } from "react";
import { useChatStore } from "@/store/useChatStore";
import type { ChartDTO } from "@/models/dto/charts";
import { LineChartView } from "@/components/charts/LineChartView";
import { AreaChartView } from "@/components/charts/AreaChartView";
import { BarChartView } from "@/components/charts/BarChartView";
import { PieChartView } from "@/components/charts/PieChartView";
import { RadarChartView } from "@/components/charts/RadarChartView";
import { ScatterChartView } from "@/components/charts/ScatterChartView";
import { HistogramChartView } from "@/components/charts/HistogramChartView";
import { WaterfallChartView } from "@/components/charts/WaterfallChartView";
import { BoxChartView } from "@/components/charts/BoxChartView";
import type { StatisticalTestResultDTO } from "@/models/dto/response";
import { MannWhitneyUView } from "@/components/charts/MannWhitneyUView";
import { useTranslation } from 'react-i18next';
import '@/i18n';

export default function VisualizationWindow() {
  const visualization = useChatStore((s) => s.visualization);
  const selectedIndex = useChatStore((s) => s.selectedChartIndex);
  const selectedStatIndex = useChatStore((s) => s.selectedStatisticsIndex);
  const { t } = useTranslation('common');

  const activeChartIndex =
    selectedIndex !== null
      ? selectedIndex
      : visualization?.charts && visualization.charts.length > 0
        ? 0
        : null;
  const activeStatIndex =
    selectedStatIndex !== null
      ? selectedStatIndex
      : activeChartIndex === null && visualization?.stats && visualization.stats.length > 0
        ? 0
        : null;

  const showStat = activeStatIndex !== null && visualization?.stats && visualization.stats[activeStatIndex];
  const showChart = activeChartIndex !== null && visualization?.charts && visualization.charts[activeChartIndex] && !showStat;

  if (!visualization || (!showChart && !showStat)) {
    return (
      <div>
        <div className=" font-semibold text-primary">{t('visualization.title')}</div>
        <div className="text-center text-muted-foreground p-4">{t('visualization.none')}</div>
      </div>
    );
  }

  if (showStat) {
    const stats = visualization.stats as StatisticalTestResultDTO[];
    const result = stats[activeStatIndex];
    if (result.test_type === 'MANN_WHITNEY_U_TEST') {
      return <div className="relative h-full w-full overflow-auto p-4"><MannWhitneyUView result={result} /></div>;
    }
    return (
      <div className="relative h-full w-full overflow-auto p-4">
        <div className="rounded border bg-muted/40 p-4">
          <div className="font-semibold">{result.title || result.test_type}</div>
          <div className="mt-1 text-sm text-muted-foreground">Status: {result.status}</div>
          {typeof result.p_value === "number" && (
            <div className="text-sm text-muted-foreground">P-value: {result.p_value}</div>
          )}
          {result.reason && (
            <div className="mt-1 text-sm text-muted-foreground">{result.reason}</div>
          )}
        </div>
      </div>
    );
  }

  const charts = visualization.charts as ChartDTO[];

  if (charts.length === 0 || activeChartIndex === null || activeChartIndex >= charts.length) {
    return <div className="text-center text-muted-foreground p-4">{t('visualization.none')}</div>;
  }

  const chart: ChartDTO = charts[activeChartIndex] as ChartDTO;

  let content: ReactElement | null = null;

  if (chart.type === "LINE") {
    content = <LineChartView chart={chart} />;
  }

  if (chart.type === 'BOX') {
    content = <BoxChartView chart={chart} />;
  }

  if (chart.type === "AREA") {
    content = <AreaChartView chart={chart} />;
  }

  if (chart.type === "BAR") {
    content = <BarChartView chart={chart} />;
  }

  if (chart.type === "PIE") {
    content = <PieChartView chart={chart} />;
  }

  if (chart.type === "RADAR") {
    content = <RadarChartView chart={chart} />;
  }

  if (chart.type === "SCATTER") {
    content = <ScatterChartView chart={chart} />;
  }

  if (chart.type === 'HISTOGRAM') {
    content = <HistogramChartView chart={chart} />;
  }

  if (chart.type === 'WATERFALL') {
    content = <WaterfallChartView chart={chart} />;
  }

  if (!content) {
    return null;
  }

  return <div className="relative h-full w-full">{content}</div>;
}
