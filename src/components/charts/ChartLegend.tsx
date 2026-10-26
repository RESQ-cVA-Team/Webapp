import type { ReactNode } from "react";
import type { AngelsAwardsZone } from "@/lib/chart-utils";

interface LegendEntry {
  color?: string;
  dataKey?: string | number;
  inactive?: boolean;
  type?: string;
  value?: ReactNode;
}

interface Props {
  payload?: LegendEntry[];
  zones: AngelsAwardsZone[];
}

export function ChartLegend({ payload = [], zones }: Props) {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-x-4 gap-y-1 p-0 text-sm">
      {payload.map((entry, index) => (
        <li
          key={`series-${entry.dataKey ?? index}`}
          className="flex items-center gap-1.5"
          style={{ opacity: entry.inactive ? 0.5 : 1 }}
        >
          <svg aria-hidden="true" width="14" height="12" viewBox="0 0 14 12">
            {entry.type === "line" ? (
              <line
                x1="0"
                y1="6"
                x2="14"
                y2="6"
                stroke={entry.color}
                strokeWidth="2"
              />
            ) : (
              <rect x="2" y="2" width="10" height="8" fill={entry.color} />
            )}
          </svg>
          <span>{entry.value}</span>
        </li>
      ))}
      {zones.map((zone, index) => (
        <li key={`award-${zone.label}-${index}`} className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="14" height="12" viewBox="0 0 14 12">
            <rect
              x="1"
              y="1"
              width="12"
              height="10"
              fill={zone.color}
              fillOpacity="0.5"
              stroke={zone.color}
            />
          </svg>
          <span>{zone.label}</span>
        </li>
      ))}
    </ul>
  );
}