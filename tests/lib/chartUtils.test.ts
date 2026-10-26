import { describe, expect, it } from "vitest";
import { getAngelsAwardsZones } from "@/lib/chart-utils";

describe("getAngelsAwardsZones", () => {
  it("converts thresholds to adjacent tier zones and omits duplicate Platinum", () => {
    expect(
      getAngelsAwardsZones({
        AA_DTN_LE60: { gold: 50, platinum: 75, diamond: 75 },
      }),
    ).toEqual([
      { from: 50, to: 75, label: "Gold (≥ 50)", color: "var(--aa-gold)" },
      { from: 75, to: undefined, label: "Diamond (≥ 75)", color: "var(--aa-diamond)" },
    ]);
  });

  it("keeps Platinum when its threshold differs from Diamond", () => {
    expect(
      getAngelsAwardsZones({
        AA_DTN_LE60: { platinum: 70, diamond: 75 },
      }),
    ).toEqual([
      { from: 70, to: 75, label: "Platinum (≥ 70)", color: "var(--aa-platinum)" },
      { from: 75, to: undefined, label: "Diamond (≥ 75)", color: "var(--aa-diamond)" },
    ]);
  });

  it("supports less-than and greater-than thresholds", () => {
    expect(
      getAngelsAwardsZones({
        AA_DTN_LE45: { platinum: { lt: 50 }, diamond: 50 },
        AA_STROKE_UNIT: { diamond: { gt: 0 } },
      }),
    ).toEqual([
      { from: 0, to: 50, label: "Platinum (< 50)", color: "var(--aa-platinum)" },
      { from: 50, to: undefined, label: "Diamond (≥ 50)", color: "var(--aa-diamond)" },
      { from: 0, to: undefined, label: "Diamond (YES)", color: "var(--aa-diamond)" },
    ]);
  });

  it("returns no zones when Angels Awards metadata is absent", () => {
    expect(getAngelsAwardsZones()).toEqual([]);
  });
});