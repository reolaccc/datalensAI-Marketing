import type { ColumnNameMapping } from "./types.js";

function baseCanonicalName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function canonicalizeColumnName(value: string) {
  const canonical = baseCanonicalName(value);
  return canonical || "column";
}

export function normalizeColumnNames(columnNames: string[]) {
  const seen = new Map<string, number>();
  const mappings: ColumnNameMapping[] = [];

  for (const originalName of columnNames) {
    const baseName = canonicalizeColumnName(originalName);
    const nextIndex = (seen.get(baseName) ?? 0) + 1;
    seen.set(baseName, nextIndex);

    const canonicalName = nextIndex === 1 ? baseName : `${baseName}_${nextIndex}`;
    mappings.push({
      originalName,
      canonicalName,
      duplicateIndex: nextIndex === 1 ? undefined : nextIndex,
      wasChanged: originalName !== canonicalName
    });
  }

  return mappings;
}
