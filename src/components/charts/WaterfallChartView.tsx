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
import type { WaterfallChartDTO } from "@/models/dto/charts";
import { getWaterfallBars } from "@/lib/chart-utils";

interface Props {
  chart: WaterfallChartDTO;
}

export function WaterfallChartView({ chart }: Props) {
  const data = getWaterfallBars(chart);

  return (
    <div className="h-full w-full flex flex-col flex-1">
      <h3 className="text-lg font-semibold mb-2 text-primary">{chart.metadata.title}</h3>
      <div className="flex-1 min-h-0">
          <BarChart data={data} stackOffset="sign" responsive={true} style={{ width: '100%', height: '100%' }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              label={{
                value: chart.metadata?.x_axis?.label ?? "",
                position: "insideBottomRight",
                offset: -5,
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
            <Tooltip 
              cursor={{ fill: "oklch(from var(--foreground) l c h / 0.35)"}}
              animationEasing="spring" 
              contentStyle={{ backgroundColor: "var(--card)", borderRadius: "var(--radius)",  minWidth: "100px", fontSize: "0.75rem", fontWeight: "bold" }}            />
            <Legend />
            <Bar
              dataKey="value"
              name={chart.metadata?.y_axis?.label ?? ""}
              fill="hsl(140, 70%, 45%)"
              isAnimationActive={false}
            />
          </BarChart>
      </div>
    </div>
  );
}
