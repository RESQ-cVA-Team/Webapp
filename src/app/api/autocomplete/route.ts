import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
    const filePath = path.join(process.cwd(), "data", "QI_info 3(in).csv");
    const filePath = path.join(process.cwd(), )
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // Extract COLUMN values
    const headers = lines[0].split(";");
    const columnIndex = headers.indexOf("COLUMN");

    if (columnIndex === -1) {
        return NextResponse.json({ error: "COLUMN header not found" }, { status: 400 });
    }

    const values = lines
        .slice(1)
        .map((line) => line.split(";")[columnIndex])
        .filter((v) => v && v.trim().length > 0);

    const uniqueValues = Array.from(new Set(values));

    return NextResponse.json(uniqueValues);
}
