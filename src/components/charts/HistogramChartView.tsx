"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import type { HistogramChartDTO } from "@/models/dto/charts";
import { getDynamicCategoryTickLayout } from "@/lib/chart-utils";
import { useElementWidth } from "@/hooks/use-element-width";

interface Props {
  chart: HistogramChartDTO;
}

export function HistogramChartView({ chart }: Props) {
  const { elementRef: chartContainerRef, widthPx: chartWidthPx } = useElementWidth<HTMLDivElement>(1000);

  const data = chart.data.map((bin, index) => ({
    index,
    range: bin.label ?? `${bin.range_start} – ${bin.range_end}`,
    value: chart.cumulative ? bin.density ?? bin.frequency : bin.frequency,
  }));

    const yLabel = chart.cumulative
    ? chart.metadata?.y_axis?.label ?? "Density / Cumulative"
    : chart.metadata?.y_axis?.label ?? "Frequency";
  
  const tickLayout = getDynamicCategoryTickLayout({
    chartWidthPx,
    pointCount: data.length,
    rotateThresholdPx: 70,
    horizontalMinTickSpacingPx: 10,
    rotatedMinTickSpacingPx: 30,
    rotatedAngle: -45,
    labelHeightBig: 70,
    labelHeightSmall: 50,
  });

  return (
    <div className="h-full w-full flex flex-col flex-1">
      <h3 className="text-lg font-semibold mb-2 text-primary">{chart.metadata.title}</h3>
      <div ref={chartContainerRef} className="flex-1 min-h-0">
          <BarChart data={data} barGap={-0.1} barCategoryGap={-.5} responsive={true} style={{ width: '100%', height: '100%' }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="range"
              angle={tickLayout.angle}
              textAnchor={tickLayout.textAnchor}
              height={tickLayout.height}
              interval={tickLayout.interval}
              label={{
                value: chart.metadata?.x_axis?.label ?? "",
                position: "insideBottomRight",
                offset: -5,
              }}
            />
            <YAxis
              label={{
                value: yLabel,
                angle: -90,
                position: "center",
                dx: -20,
              }}
            />
            <Tooltip 
              cursor={{ fill: "oklch(from var(--foreground) l c h / 0.35)" }} 
              animationEasing="spring" 
              contentStyle={{ backgroundColor: "var(--card)", borderRadius: "var(--radius)",  minWidth: "100px", fontSize: "0.75rem", fontWeight: "bold" }}
            />
            <Legend />
            <Bar
              dataKey="value"
              name={chart.metadata?.y_axis?.label ?? ""}
              fill="hsl(200, 70%, 50%)"
              isAnimationActive={false}

            />
          </BarChart>
      </div>
    </div>
  );
}
