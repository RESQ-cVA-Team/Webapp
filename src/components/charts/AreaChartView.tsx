"use client";

import {
  AreaChart as RCAreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import type { AreaChartDTO } from "@/models/dto/charts";
import { getSeriesColor } from "@/lib/chart-utils";

interface Props {
  chart: AreaChartDTO;
}

export function AreaChartView({ chart }: Props) {
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

  const data = bins.map((bin) => {
    const point: Record<string, number | string> = { bin };
    chart.series.forEach((s) => {
      const val = s.data.find((p) => String(p.x) === String(bin))?.y ?? NaN;
      point[s.name] = val;
    });
    return point;
  });

  return (
    <div className="h-full w-full flex flex-col flex-1">
      <h3 className="text-lg font-semibold mb-2 text-primary">{chart.metadata.title}</h3>
      <div className="flex-1 min-h-0">
          <RCAreaChart data={data} responsive={true} style={{ width: '100%', height: '100%' }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="bin"
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
              animationEasing="spring"
              contentStyle={{ backgroundColor: "var(--card)", borderRadius: "var(--radius)",  minWidth: "100px", fontSize: "0.75rem", fontWeight: "bold" }}
             />            
             <Legend />
            {chart.series.map((s, i) => (
              <Area
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={getSeriesColor(i)}
                fill={getSeriesColor(i)}
                fillOpacity={0.25}
                stackId={chart.stacked ? "1" : undefined}
                isAnimationActive={false}
              />
            ))}
          </RCAreaChart>
      </div>
    </div>
  );
}
