"use client";

import {
  LineChart,
  Line,
  AreaChart as RCAreaChart,
  Area,
  BarChart as RCBarChart,
  Bar,
  PieChart as RCPieChart,
  Pie,
  RadarChart as RCRadarChart,
  Radar,
  ScatterChart as RCScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import type { 
  LineChartDTO, 
  AreaChartDTO, 
  BarChartDTO, 
  PieChartDTO, 
  RadarChartDTO,
  BoxChartDTO,
  ScatterChartDTO,
  HistogramChartDTO,
  WaterfallChartDTO,
} from "@/models/dto/charts";
import { getSeriesColor } from "@/lib/chart-utils";

const THUMBNAIL_MARGIN = { top: 5, right: 10, bottom: 0, left: 10 };


// LINE CHART THUMBNAIL
export function LineChartThumbnail({ chart }: { chart: LineChartDTO }) {
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
  const isTimeAxis = chart.metadata?.x_axis?.type === "time";

  const data = bins.map((bin) => {
    const point: Record<string, number | string | null> = {
      bin,
    };
    chart.series.forEach((s) => {
      const val = s.data.find((p) => String(p.x) === String(bin))?.y;
      point[s.name] = isTimeAxis && typeof val === "number" && val === 0 ? null : (val ?? null);
    });
    return point;
  });

  return (
        <LineChart data={data} margin={THUMBNAIL_MARGIN} responsive={true} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        {chart.series.map((s, i) => (
          <Line
            key={s.name}
            type={chart.smooth ? "monotone" : "linear"}
            dataKey={s.name}
            stroke={getSeriesColor(i)}
            strokeWidth={2}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
  );
}

// AREA CHART THUMBNAIL
export function AreaChartThumbnail({ chart }: { chart: AreaChartDTO }) {
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
        <RCAreaChart data={data} margin={THUMBNAIL_MARGIN} responsive={true} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        {chart.series.map((s, i) => (
          <Area
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={getSeriesColor(i)}
            fill={getSeriesColor(i)}
            fillOpacity={0.6}
            activeDot={false}
            isAnimationActive={false}
          />
        ))}
      </RCAreaChart>
  );
}

// BAR CHART THUMBNAIL
export function BarChartThumbnail({ chart }: { chart: BarChartDTO }) {
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
    const point: Record<string, number | string | null> = { bin };
    chart.series.forEach((s) => {
      const val = s.data.find((p) => String(p.x) === String(bin))?.y;
      point[s.name] = typeof val === "number" && val === 0 ? null : (val ?? null);
    });
    return point;
  });

  return (
        <RCBarChart data={data} margin={THUMBNAIL_MARGIN} responsive={true} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        {chart.series.map((s, i) => (
          <Bar
            key={s.name}
            dataKey={s.name}
            fill={getSeriesColor(i)}
            isAnimationActive={false}
          />
        ))}
      </RCBarChart>
  );
}

// PIE CHART THUMBNAIL
export function PieChartThumbnail({ chart }: { chart: PieChartDTO }) {
  return (
  <RCPieChart margin={THUMBNAIL_MARGIN} responsive={true} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        <Pie
          data={chart.data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          outerRadius={"80%"}
          innerRadius={chart.donut ? 30 : 0}
          label={false}
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
  );
}

// RADAR CHART THUMBNAIL
export function RadarChartThumbnail({ chart }: { chart: RadarChartDTO }) {
  const data = chart.axes.map((axis) => {
    const point: Record<string, number | string> = { axis };
    chart.series.forEach((s) => {
      const val = s.data.find((p) => String(p.x) === String(axis))?.y ?? NaN;
      point[s.name] = val;
    });
    return point;
  });

  return (

      <RCRadarChart data={data} margin={THUMBNAIL_MARGIN} responsive={true} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        {chart.series.map((s, i) => (
          <Radar
            key={s.name}
            name={s.name}
            dataKey={s.name}
            stroke={getSeriesColor(i)}
            fill={getSeriesColor(i)}
            fillOpacity={0.3}
            isAnimationActive={false}
            activeDot={false}
          />
        ))}
      </RCRadarChart>
  );
}

// SCATTER CHART THUMBNAIL
export function ScatterChartThumbnail({ chart }: { chart: ScatterChartDTO }) {
  return (
  <RCScatterChart margin={THUMBNAIL_MARGIN} responsive={true} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        <XAxis type="number" dataKey="x" hide domain={["auto", "auto"]} />
        <YAxis type="number" dataKey="y" hide domain={["auto", "auto"]} />
        {chart.series.map((s, i) => (
          <Scatter
            key={s.name}
            name={s.name}
            data={s.data.map((p) => ({ x: p.x, y: p.y }))}
            fill={getSeriesColor(i)}
            shape="circle"
            fillOpacity={0.9}
            isAnimationActive={false}
          />
        ))}
      </RCScatterChart>
  );
}

// BOX CHART THUMBNAIL
export function BoxChartThumbnail({ chart }: { chart: BoxChartDTO }) {
  const data = chart.data.map((entry) => ({
    name: entry.name,
    q1: entry.q1,
    median: entry.median,
    q3: entry.q3,
    min: entry.min,
    max: entry.max,
  }));

  return (
      <RCBarChart data={data} margin={THUMBNAIL_MARGIN} responsive={true} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        <Bar dataKey="median" fill="hsl(200, 70%, 50%)" isAnimationActive={false} />
      </RCBarChart>
  );
}

// HISTOGRAM CHART THUMBNAIL
export function HistogramChartThumbnail({ chart }: { chart: HistogramChartDTO }) {
  const data = chart.data.map((bin) => ({
    value: chart.cumulative ? bin.density ?? bin.frequency : bin.frequency,
  }));

  return (

      <RCBarChart data={data} margin={THUMBNAIL_MARGIN} responsive={true} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        <Bar dataKey="value" fill="hsl(200, 70%, 50%)" isAnimationActive={false} />
      </RCBarChart>
  );
}

// WATERFALL CHART THUMBNAIL
export function WaterfallChartThumbnail({ chart }: { chart: WaterfallChartDTO }) {
  const data = chart.data.map((step) => ({ value: step.value }));

  return (
      <RCBarChart data={data} margin={THUMBNAIL_MARGIN} responsive={true} style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}>
        <Bar dataKey="value" fill="hsl(200, 70%, 50%)" isAnimationActive={false} />
      </RCBarChart>
  );
}
