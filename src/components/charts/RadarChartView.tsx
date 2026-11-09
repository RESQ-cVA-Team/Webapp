"use client";

import {
  RadarChart as RCRadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  Legend,
} from "recharts";
import type { RadarChartDTO } from "@/models/dto/charts";
import { getSeriesColor } from "@/lib/chart-utils";

interface Props {
  chart: RadarChartDTO;
}

export function RadarChartView({ chart }: Props) {
  const data = chart.axes.map((axis) => {
    const point: Record<string, number | string> = { axis };
    chart.series.forEach((s) => {
      const val = s.data.find((p) => String(p.x) === String(axis))?.y ?? NaN;
      point[s.name] = val;
    });
    return point;
  });

  return (
    <div className="h-full w-full flex flex-col flex-1">
      <h3 className="text-lg font-semibold mb-2 text-primary">{chart.metadata.title}</h3>
      <div className="flex-1 min-h-0">
          <RCRadarChart data={data} responsive={true} style={{ width: '100%', height: '100%' }}>
            <PolarGrid />
            <PolarAngleAxis dataKey="axis" />
            <PolarRadiusAxis />
            <Legend />
            <Tooltip 
              animationEasing="spring"
              contentStyle={{ backgroundColor: "var(--card)", borderRadius: "var(--radius)",  minWidth: "100px", fontSize: "0.75rem", fontWeight: "bold" }} 
            />      
            {chart.series.map((s, i) => (
              <Radar
                key={s.name}
                name={s.name}
                dataKey={s.name}
                stroke={getSeriesColor(i)}
                fill={getSeriesColor(i)}
                fillOpacity={0.3}
                isAnimationActive={false}
              />
            ))}
          </RCRadarChart>
      </div>
    </div>
  );
}
