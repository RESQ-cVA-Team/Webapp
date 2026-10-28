import { describe, expect, it } from "vitest";
import { getAngelsAwardsConditions, getAngelsAwardsZones } from "@/lib/chart-utils";

describe("getAngelsAwardsZones", () => {
  it("draws one zone per minimum share, up to the next one", () => {
    expect(
      getAngelsAwardsZones({
        AA_RECANALIZATION: { gold: { min_percent: 5 }, platinum: { min_percent: 15 }, diamond: { min_percent: 25 } },
      }),
    ).toEqual([
      { from: 5, to: 15, label: "Gold (≥ 5%)", color: "var(--aa-gold)" },
      { from: 15, to: 25, label: "Platinum (≥ 15%)", color: "var(--aa-platinum)" },
      { from: 25, to: undefined, label: "Diamond (≥ 25%)", color: "var(--aa-diamond)" },
    ]);
  });

  it("gives levels with the same minimum one zone that names both", () => {
    expect(
      getAngelsAwardsZones({
        AA_DTN_LE60: { gold: { min_percent: 50 }, platinum: { min_percent: 75 }, diamond: { min_percent: 75 } },
      }),
    ).toEqual([
      { from: 50, to: 75, label: "Gold (≥ 50%)", color: "var(--aa-gold)" },
      { from: 75, to: undefined, label: "Platinum / Diamond (≥ 75%)", color: "var(--aa-diamond)" },
    ]);
  });

  it("draws only the levels that have a requirement", () => {
    expect(getAngelsAwardsZones({ AA_DTN_LE45: { diamond: { min_percent: 50 } } })).toEqual([
      { from: 50, to: undefined, label: "Diamond (≥ 50%)", color: "var(--aa-diamond)" },
    ]);
  });

  it("draws no zone for a required condition", () => {
    expect(getAngelsAwardsZones({ AA_STROKE_UNIT: { diamond: { required: true } } })).toEqual([]);
  });

  it("returns no zones when Angels Awards metadata is absent", () => {
    expect(getAngelsAwardsZones()).toEqual([]);
  });
});

describe("getAngelsAwardsConditions", () => {
  it("lists the levels that require a condition", () => {
    expect(
      getAngelsAwardsConditions({
        AA_STROKE_UNIT: { diamond: { required: true } },
        AA_DTN_LE45: { diamond: { min_percent: 50 } },
      }),
    ).toEqual([{ label: "Diamond (required)", color: "var(--aa-diamond)" }]);
  });

  it("returns nothing when Angels Awards metadata is absent", () => {
    expect(getAngelsAwardsConditions()).toEqual([]);
  });
});
