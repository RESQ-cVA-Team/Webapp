"use client";

import {
  PieChart as RCPieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import type { PieChartDTO } from "@/models/dto/charts";
import { getSeriesColor } from "@/lib/chart-utils";

interface Props {
  chart: PieChartDTO;
}

export function PieChartView({ chart }: Props) {
  return (
    <div className="h-full w-full flex flex-col flex-1">
      <h3 className="text-lg font-semibold mb-2 text-primary ">{chart.metadata.title}</h3>
      <div className="flex-1 min-h-0">
          <RCPieChart responsive={true} style={{ width: '100%', height: '100%' }}>
            <Tooltip 
              animationEasing="spring"
              contentStyle={{ backgroundColor: "var(--card)", borderRadius: "var(--radius)", minWidth: "100px", fontSize: "0.75rem", fontWeight: "bold" }}
             />      
            <Legend />
            <Pie
              data={chart.data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={"80%"}
              innerRadius={chart.donut ? 50 : 0}
              label
              isAnimationActive={false}
            >
              {chart.data.map((s, i) => (
                <Cell
                  key={`slice-${i}`}
                  fill={s.color || getSeriesColor(i)}
                />
              ))}
            </Pie>
          </RCPieChart>
      </div>
    </div>
  );
}
