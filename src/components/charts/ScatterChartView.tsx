"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import type { ScatterChartDTO } from "@/models/dto/charts";
import { getSeriesColor } from "@/lib/chart-utils";

interface Props {
  chart: ScatterChartDTO;
}

export function ScatterChartView({ chart }: Props) {
  // Flatten each series to include its name so we can plot multiple series.
  const data = chart.series.flatMap((series) =>
    series.data.map((point) => ({
      x: point.x,
      y: point.y,
      series: series.name,
    })),
  );

  return (
    <div className="h-full w-full flex flex-col flex-1">
      <h3 className="text-lg font-semibold mb-2 text-primary">{chart.metadata.title}</h3>
      <div className="flex-1 min-h-0">
          <ScatterChart margin={{ top: 10, right: 0, bottom: 0, left: 0 }} responsive={true} style={{ width: '100%', height: '100%' }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              name={chart.metadata?.x_axis?.label ?? ""}
              label={{
                value: chart.metadata?.x_axis?.label ?? "",
                position: "insideBottomRight",
                offset: -5,
              }}
            />
            <YAxis
              dataKey="y"
              name={chart.metadata?.y_axis?.label ?? ""}
              label={{
                value: chart.metadata?.y_axis?.label ?? "",
                angle: -90,
                position: "center",
                dx: -20,
              }}
            />
            <Tooltip 
              cursor={{ fill: "oklch(from var(--foreground) l c h / 0.35)", strokeDasharray: "3 3" }} 
              animationEasing="spring" 
              contentStyle={{ backgroundColor: "var(--card)", borderRadius: "var(--radius)",  minWidth: "100px", fontSize: "0.75rem", fontWeight: "bold" }}
            />
            <Legend />
            {chart.series.map((series, index) => (
              <Scatter
                key={series.name}
                name={series.name}
                dataKey="y"
                data={data.filter((d) => d.series === series.name)}
                fill={getSeriesColor(index)}
                isAnimationActive={false}
                shape={<circle r={10} />}
              />
            ))}
          </ScatterChart>
      </div>
    </div>
  );
}
