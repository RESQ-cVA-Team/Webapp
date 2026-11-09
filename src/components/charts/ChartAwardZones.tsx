import { Fragment } from "react";
import { ReferenceArea, ReferenceLine } from "recharts";
import type { AngelsAwardsZone } from "@/lib/chart-utils";

interface Props {
  zones: AngelsAwardsZone[];
  axis?: "x" | "y";
}

export function ChartAwardZones({ zones, axis = "y" }: Props) {
  return (
    <>
      {zones.map((zone, index) => (
        <Fragment key={`${zone.label}-${zone.from}-${index}`}>
          <ReferenceArea
            ifOverflow="extendDomain"
            zIndex={0}
            {...(axis === "x"
              ? { x1: zone.from, x2: zone.to }
              : { y1: zone.to, y2: zone.from })}
            fill={zone.color}
            fillOpacity={0.5}
            stroke="none"
          />
          <ReferenceArea
            ifOverflow="extendDomain"
            zIndex={500}
            {...(axis === "x"
              ? { x1: zone.from, x2: zone.to }
              : { y1: zone.to, y2: zone.from })}
            fill={zone.color}
            fillOpacity={0.2}
            stroke="none"
          />
          <ReferenceLine
            {...(axis === "x" ? { x: zone.from } : { y: zone.from })}
            stroke={"white"}
            strokeOpacity={0.5}
            strokeWidth={1}
            zIndex={1000}
          />
        </Fragment>
      ))}
    </>
  );
}