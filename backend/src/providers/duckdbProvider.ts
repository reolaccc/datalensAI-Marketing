import type { DatasetRow } from "../analytics/types.js";

export async function loadRowsIntoDuckDb(rows: DatasetRow[]): Promise<{ rowCount: number; columnCount: number }> {
  // Slice 1 keeps the analytics contract stable while deferring a native DuckDB
  // binding until the runtime is pinned to a supported Node version.
  return {
    rowCount: rows.length,
    columnCount: Object.keys(rows[0] ?? {}).length
  };
}
