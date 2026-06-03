import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import YAML from "yaml";

type SsotEntry = {
    canonical?: string;
    synonyms?: string[];
};

function toUniqueStrings(values: Iterable<string>): string[] {
    return Array.from(
        new Set(
            Array.from(values)
                .map((value) => value.trim())
                .filter((value) => value.length > 0)
        )
    ).sort((left, right) => left.localeCompare(right));
}

export async function GET() {
    try {
        const ssotDir = path.join(process.cwd(), "src", "shared", "SSOT");
        const fileNames = await fs.readdir(ssotDir);
        const yamlFiles = fileNames.filter((fileName) => /\.ya?ml$/i.test(fileName));

        const extractedValues = await Promise.all(
            yamlFiles.map(async (fileName) => {
                const filePath = path.join(ssotDir, fileName);
                const content = await fs.readFile(filePath, "utf-8");
                const parsed = YAML.parse(content);

                if (!Array.isArray(parsed)) {
                    return [] as string[];
                }

                return parsed.flatMap((entry) => {
                    const record = entry as SsotEntry;
                    const firstSynonym = record.synonyms?.[0];
                    return typeof firstSynonym === "string" ? [firstSynonym] : [];
                });
            })
        );

        return NextResponse.json(toUniqueStrings(extractedValues.flat()));
    } catch (error) {
        console.error("Failed to load SSOT autocomplete values", error);
        return NextResponse.json({ error: "Failed to load autocomplete values" }, { status: 500 });
    }
}
