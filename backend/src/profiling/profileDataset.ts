import type {
  DatasetColumnProfile,
  DatasetProfile,
  DatasetRow
} from "../analytics/types.js";
import { buildCleanedDatasetProfile } from "../analytics/normalization/index.js";
import { buildSemanticDatasetContract } from "../analytics/semanticContract.js";
import {
  median,
  parseDateValue,
  parseNumber,
  pearsonCorrelation,
  quantile
} from "../utils/inference.js";

function detectColumnKind(values: Array<string | number | boolean | null>) {
  const populated = values.filter((value) => value !== null);
  if (populated.length === 0) {
    return "categorical" as const;
  }

  const numericCount = populated.filter((value) => parseNumber(value) !== null).length;
  const datetimeCount = populated.filter((value) => parseDateValue(value) !== null).length;

  if (numericCount / populated.length >= 0.9) {
    return "numeric" as const;
  }

  if (datetimeCount / populated.length >= 0.8) {
    return "datetime" as const;
  }

  return "categorical" as const;
}

function summarizeNumericColumn(name: string, values: Array<string | number | boolean | null>): DatasetColumnProfile {
  const numericValues = values
    .map((value) => parseNumber(value))
    .filter((value): value is number => value !== null);
  const uniqueCount = new Set(numericValues).size;

  return {
    name,
    kind: "numeric",
    missingCount: values.length - numericValues.length,
    uniqueCount,
    sampleValues: numericValues.slice(0, 5),
    min: Math.min(...numericValues),
    max: Math.max(...numericValues),
    mean: numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length,
    median: median(numericValues)
  };
}

function summarizeDatetimeColumn(name: string, values: Array<string | number | boolean | null>): DatasetColumnProfile {
  const datetimeValues = values
    .map((value) => parseDateValue(value))
    .filter((value): value is Date => value !== null);
  const asIso = datetimeValues.map((value) => value.toISOString());

  return {
    name,
    kind: "datetime",
    missingCount: values.length - datetimeValues.length,
    uniqueCount: new Set(asIso).size,
    sampleValues: asIso.slice(0, 5),
    min: asIso[0],
    max: asIso[asIso.length - 1]
  };
}

function summarizeCategoricalColumn(
  name: string,
  values: Array<string | number | boolean | null>
): DatasetColumnProfile {
  const populated = values.filter((value) => value !== null).map((value) => String(value));
  const counts = new Map<string, number>();
  for (const value of populated) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const topCategories = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));

  return {
    name,
    kind: "categorical",
    missingCount: values.length - populated.length,
    uniqueCount: counts.size,
    sampleValues: populated.slice(0, 5),
    topCategories
  };
}

function getOutliers(column: DatasetColumnProfile, values: number[]) {
  if (values.length < 4) {
    return null;
  }

  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const lowerBound = q1 - iqr * 1.5;
  const upperBound = q3 + iqr * 1.5;
  const outliers = values.filter((value) => value < lowerBound || value > upperBound);

  if (outliers.length === 0) {
    return null;
  }

  return {
    column: column.name,
    count: outliers.length,
    min: Math.min(...outliers),
    max: Math.max(...outliers)
  };
}

export function profileDataset(rows: DatasetRow[]): DatasetProfile {
  const headers = Object.keys(rows[0] ?? {});
  const normalizedProfile = buildCleanedDatasetProfile(rows);
  const columns = headers.map((header) => {
    const values = rows.map((row) => row[header] ?? null);
    const kind = detectColumnKind(values);

    if (kind === "numeric") {
      return summarizeNumericColumn(header, values);
    }

    if (kind === "datetime") {
      return summarizeDatetimeColumn(header, values);
    }

    return summarizeCategoricalColumn(header, values);
  });

  const numericColumns = columns.filter((column) => column.kind === "numeric");
  const categoricalColumns = columns.filter((column) => column.kind === "categorical").map((column) => column.name);
  const datetimeColumns = columns.filter((column) => column.kind === "datetime").map((column) => column.name);

  const duplicateRowCount = rows.length - new Set(rows.map((row) => JSON.stringify(row))).size;
  const missingCells = columns.reduce((sum, column) => sum + column.missingCount, 0);

  const outliers = numericColumns
    .map((column) => {
      const values = rows
        .map((row) => parseNumber(row[column.name]))
        .filter((value): value is number => value !== null);
      return getOutliers(column, values);
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const correlations: DatasetProfile["correlations"] = [];
  for (let index = 0; index < numericColumns.length; index += 1) {
    for (let innerIndex = index + 1; innerIndex < numericColumns.length; innerIndex += 1) {
      const left = numericColumns[index];
      const right = numericColumns[innerIndex];
      const pairs = rows
        .map((row) => [parseNumber(row[left.name]), parseNumber(row[right.name])] as const)
        .filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null);

      const coefficient = pearsonCorrelation(
        pairs.map((pair) => pair[0]),
        pairs.map((pair) => pair[1])
      );

      if (Math.abs(coefficient) >= 0.65) {
        correlations.push({
          x: left.name,
          y: right.name,
          coefficient: Number(coefficient.toFixed(3))
        });
      }
    }
  }

  const profileWithoutSemantic: DatasetProfile = {
    rowCount: rows.length,
    columnCount: headers.length,
    duplicateRowCount,
    missingCells,
    numericColumns: numericColumns.map((column) => column.name),
    categoricalColumns,
    datetimeColumns,
    columns,
    outliers,
    correlations,
    normalizedProfile
  };

  return {
    ...profileWithoutSemantic,
    semanticContract: buildSemanticDatasetContract(profileWithoutSemantic)
  };
}
