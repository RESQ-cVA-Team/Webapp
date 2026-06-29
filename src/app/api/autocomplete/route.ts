import { NextResponse, NextRequest } from "next/server";
import { auth } from "@/auth";
import { promises as fs } from "fs";
import path from "path";
import YAML from "yaml";
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from "@/locales/config";

type SsotEntry = {
    canonical?: string;
    synonyms?: Record<string, string[]>;
    description?: Record<string, string>;
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

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        // Get language from query parameters, default to 'en'
        const searchParams = request.nextUrl.searchParams;
        const language = searchParams.get("language") || DEFAULT_LANGUAGE;

        // Validate language is supported
        if (!SUPPORTED_LANGUAGES.includes(language as any)) {
            return NextResponse.json(
                { error: `Unsupported language: ${language}` },
                { status: 400 }
            );
        }

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
                    const results: string[] = [];

                    // Include the canonical entry
                    if (record.canonical) {
                        results.push(record.canonical);
                    }

                    // Include synonyms for the requested language
                    const synonymsByLanguage = record.synonyms;
                    if (
                        synonymsByLanguage &&
                        typeof synonymsByLanguage === "object" &&
                        language in synonymsByLanguage
                    ) {
                        const langSynonyms = synonymsByLanguage[language];
                        if (Array.isArray(langSynonyms)) {
                            results.push(...langSynonyms);
                        }
                    }

                    return results;
                });
            })
        );

        return NextResponse.json(toUniqueStrings(extractedValues.flat()));
    } catch (error) {
        console.error("Failed to load SSOT autocomplete values", error);
        return NextResponse.json({ error: "Failed to load autocomplete values" }, { status: 500 });
    }
}
