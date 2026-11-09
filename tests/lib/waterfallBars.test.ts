import { describe, expect, it } from "vitest";
import { getWaterfallBars } from "@/lib/chart-utils";
import type { WaterfallChartDTO } from "@/models/dto/charts";

function chart(data: WaterfallChartDTO["data"], start_value?: number): WaterfallChartDTO {
  return { type: "WATERFALL", metadata: {} as WaterfallChartDTO["metadata"], data, start_value };
}

describe("getWaterfallBars", () => {
  it("starts each step where the previous one ended", () => {
    expect(getWaterfallBars(chart([{ label: "a", value: 10 }, { label: "b", value: -4 }, { label: "c", value: 6 }], 100))).toEqual([
      { label: "a", start: 100, end: 110, value: 10, isTotal: false },
      { label: "b", start: 110, end: 106, value: -4, isTotal: false },
      { label: "c", start: 106, end: 112, value: 6, isTotal: false },
    ]);
  });

  it("ends a total step at its own value and starts from zero without a start value", () => {
    expect(getWaterfallBars(chart([{ label: "a", value: 5 }, { label: "total", value: 5, is_total: true }]))).toEqual([
      { label: "a", start: 0, end: 5, value: 5, isTotal: false },
      { label: "total", start: 5, end: 5, value: 0, isTotal: true },
    ]);
  });
});
