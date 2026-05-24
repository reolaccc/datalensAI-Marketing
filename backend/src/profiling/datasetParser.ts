import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { DatasetRow, PrimitiveValue } from "../analytics/types.js";
import { sanitizeHeader } from "../utils/inference.js";

export interface ParsedDataset {
  rows: DatasetRow[];
  fileName: string;
  sheetName?: string;
}

function normalizeCell(value: unknown): PrimitiveValue {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return String(value).trim();
}

function normalizeRows(rawRows: Record<string, unknown>[]): DatasetRow[] {
  return rawRows.map((row) => {
    const normalizedEntries = Object.entries(row).map(([key, value]) => [
      sanitizeHeader(key),
      normalizeCell(value)
    ]);

    return Object.fromEntries(normalizedEntries);
  });
}

export function parseDataset(buffer: Buffer, fileName: string): ParsedDataset {
  const lowerFileName = fileName.toLowerCase();

  if (lowerFileName.endsWith(".csv")) {
    const records = parseCsv(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Record<string, unknown>[];

    return {
      rows: normalizeRows(records),
      fileName
    };
  }

  if (lowerFileName.endsWith(".xlsx") || lowerFileName.endsWith(".xls")) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: null
    });

    return {
      rows: normalizeRows(rawRows),
      fileName,
      sheetName
    };
  }

  throw new Error("Unsupported file format. Please upload a CSV or XLSX file.");
}
