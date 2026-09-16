"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import type { LineChartDTO } from "@/models/dto/charts";
import {
  getDynamicCategoryTickLayout,
  getSeriesColor,
  getPointLabelMap,
} from "@/lib/chart-utils";
import { useElementWidth } from "@/hooks/use-element-width";

interface Props {
  chart: LineChartDTO;
}

export function LineChartView({ chart }: Props) {
  const { elementRef: chartContainerRef, widthPx: chartWidthPx } = useElementWidth<HTMLDivElement>(1000);
  const seriesNames = chart.series.map((series) => series.name);
  const bins: (string | number)[] = [];
  const seen = new Set<string>();
  chart.series.forEach((s) =>
    s.data.forEach((p) => {
      const k = String(p.x);
      if (!seen.has(k)) {
        seen.add(k);
        bins.push(p.x);
      }
    }),
  );

  const pointLabelMap = getPointLabelMap(chart.series);
  const isTimeAxis = chart.metadata?.x_axis?.type === "time";

  const data = bins.map((bin) => {
    const point: Record<string, number | string | null> = {
      bin,
      binLabel: pointLabelMap.get(String(bin)) ?? String(bin),
    };
    chart.series.forEach((s) => {
      const val = s.data.find((p) => String(p.x) === String(bin))?.y;
      point[s.name] = isTimeAxis && typeof val === "number" && val === 0 ? null : (val ?? null);
    });
    return point;
  });
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
          <LineChart data={data} margin={{ top: 20, right: 50, bottom: 0, left: 20 }} responsive={true} style={{ width: '100%', height: '100%' }}>
            <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                height={tickLayout.height}
                dataKey="bin"
                tickFormatter={(value) => {
                  const rawValue = String(value);
                  const pointLabel = pointLabelMap.get(rawValue);

                  if (typeof value === "number" && value > 1000000000) {
                    const date = new Date(value * 1000);
                    const quarter = Math.floor(date.getMonth() / 3) + 1;
                    return `Q${quarter} ${date.getFullYear()}`;
                  }

                  return pointLabel ?? String(value);
                }}
                interval={tickLayout.interval}
                angle={tickLayout.angle}
                textAnchor={tickLayout.textAnchor}
                label={{
                  value: chart.metadata?.x_axis?.label ?? "",
                  position: "insideBottomRight",
                  dy: -5,
                }}
              />
            <YAxis
              label={{
                value: chart.metadata?.y_axis?.label ?? "",
                angle: -90,
                position: "center",
                dx: -20,
              }}
            />
            <Legend />
           <Tooltip 
              animationEasing="spring"
              labelFormatter={(label) => pointLabelMap.get(String(label)) ?? String(label)}
              formatter={(value, name) => [value, name]}
              contentStyle={{ backgroundColor: "var(--card)", borderRadius: "var(--radius)",  minWidth: "100px", fontSize: "0.75rem", fontWeight: "bold" }}
            />  
            {chart.series.map((s, i) => {
              const seriesColor = getSeriesColor(i);
              return (
                <Line
                  key={s.name}
                  type={chart.smooth ? "monotone" : "linear"}
                  dataKey={s.name}
                  stroke={seriesColor}
                  strokeWidth={2}
                  dot={{
                    r: 7,
                    fill: "var(--primary-foreground)",
                    stroke: seriesColor,
                    strokeWidth: 3,
                  }}
                  activeDot={{
                    r: 10,
                    fill: seriesColor,
                    stroke: "var(--primary-foreground)",
                    strokeWidth: 3,
                  }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </div>
      </div>
  );
}
