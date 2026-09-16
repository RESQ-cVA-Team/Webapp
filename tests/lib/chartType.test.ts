import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { CHART_TYPES } from "@/models/dto/types";
import { getPointLabelMap } from "@/lib/chart-utils";

type SsotEntry = {
  canonical?: string;
};

describe("CHART_TYPES", () => {
  it("matches SSOT/ChartType.yml's canonical values exactly", async () => {
    const filePath = path.join(process.cwd(), "src", "shared", "SSOT", "ChartType.yml");
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = YAML.parse(content) as SsotEntry[];

    const ssotCanonicals = parsed
      .map((entry) => entry.canonical)
      .filter((value): value is string => typeof value === "string")
      .sort();

    const chartTypes = [...CHART_TYPES].sort();

    expect(chartTypes).toEqual(ssotCanonicals);
  });
});

describe("getPointLabelMap", () => {
  it("uses point labels for numeric bucket keys when present", () => {
    const map = getPointLabelMap([
      { name: "My Hospital", data: [
        { x: 0, y: 2, label: "0-25" },
        { x: 25, y: 5, label: "25-50" },
        { x: 50, y: 8, label: "50-75" },
      ] },
      { name: "Reference", data: [
        { x: 0, y: 1 },
        { x: 25, y: 2 },
      ] },
    ]);

    expect(map.get("0")).toBe("0-25");
    expect(map.get("25")).toBe("25-50");
    expect(map.get("50")).toBe("50-75");
    expect(map.get("999")).toBeUndefined();
  });
});
