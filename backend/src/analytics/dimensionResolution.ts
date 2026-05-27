import type { SemanticDatasetContract } from "./types.js";
import { resolveSemanticDimensionSourceColumn } from "./semanticContract.js";

export type ExplicitDimensionKey =
  | "channel"
  | "campaign"
  | "region"
  | "location"
  | "device"
  | "date"
  | "account"
  | "customer"
  | "client"
  | "queue"
  | "team"
  | "service_line"
  | "warehouse"
  | "product"
  | "category"
  | "supplier";

export interface ExplicitDimensionMatch {
  canonicalKey: ExplicitDimensionKey;
  sourceColumn: string;
  matchedAlias: string;
  matchedPosition: number;
}

interface DimensionResolutionContext {
  categoricalColumns: string[];
  datetimeColumns?: string[];
  semanticContract?: SemanticDatasetContract | null;
}

type DimensionSpec = {
  canonicalKey: ExplicitDimensionKey;
  aliases: string[];
  preferDateColumns?: boolean;
  semanticFallbacks?: string[];
  rawFallbackAliases?: string[];
};

const DIMENSION_SPECS: DimensionSpec[] = [
  {
    canonicalKey: "channel",
    aliases: ["channel"],
    semanticFallbacks: ["channel", "source", "medium"],
    rawFallbackAliases: ["source", "medium", "traffic source", "traffic_source", "source medium", "source_medium", "acquisition"]
  },
  { canonicalKey: "campaign", aliases: ["campaign"] },
  { canonicalKey: "region", aliases: ["region"] },
  { canonicalKey: "location", aliases: ["location", "locations", "branch", "branches", "office", "offices", "city", "cities"] },
  { canonicalKey: "device", aliases: ["device"] },
  { canonicalKey: "date", aliases: ["date"] },
  { canonicalKey: "account", aliases: ["account", "account name", "account_name"] },
  { canonicalKey: "customer", aliases: ["customer", "customer name", "customer_name"] },
  { canonicalKey: "client", aliases: ["client", "client name", "client_name"] },
  { canonicalKey: "queue", aliases: ["queue", "queues"], rawFallbackAliases: ["queue", "queue name", "queue_name"] },
  { canonicalKey: "team", aliases: ["team", "teams"], rawFallbackAliases: ["team", "agent team", "agent_team", "support team"] },
  {
    canonicalKey: "service_line",
    aliases: ["service line", "service lines", "service", "services"],
    rawFallbackAliases: ["service_line", "service line", "service"]
  },
  { canonicalKey: "warehouse", aliases: ["warehouse", "warehouses"], rawFallbackAliases: ["warehouse", "fulfillment center"] },
  { canonicalKey: "product", aliases: ["product", "products", "sku", "skus"], rawFallbackAliases: ["product", "sku", "sku family", "sku_family"] },
  { canonicalKey: "category", aliases: ["category", "categories"], rawFallbackAliases: ["category"] },
  { canonicalKey: "supplier", aliases: ["supplier", "suppliers", "vendor", "vendors"], rawFallbackAliases: ["supplier", "vendor"] }
];

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findAliasPosition(question: string, alias: string) {
  const normalizedQuestion = normalize(question);
  const normalizedAlias = normalize(alias);
  const boundaryPattern = new RegExp(`\\b${escapeRegExp(normalizedAlias)}\\b`, "i");
  const boundaryMatch = normalizedQuestion.match(boundaryPattern);
  if (boundaryMatch && typeof boundaryMatch.index === "number") {
    return boundaryMatch.index;
  }

  const looseIndex = normalizedQuestion.indexOf(normalizedAlias);
  return looseIndex >= 0 ? looseIndex : null;
}

function scoreCandidateColumn(column: string, aliases: string[]) {
  const normalizedColumn = normalize(column);
  let bestScore = 0;

  for (const alias of aliases) {
    const normalizedAlias = normalize(alias);
    if (normalizedColumn === normalizedAlias) {
      bestScore = Math.max(bestScore, 3);
      continue;
    }
    if (normalizedColumn.includes(normalizedAlias)) {
      bestScore = Math.max(bestScore, 2);
      continue;
    }
    if (normalizedAlias.includes(normalizedColumn)) {
      bestScore = Math.max(bestScore, 1);
    }
  }

  return bestScore;
}

function resolveSemanticSourceColumn(context: DimensionResolutionContext, spec: DimensionSpec) {
  if (!context.semanticContract) {
    return null;
  }

  const candidateKeys = spec.semanticFallbacks ?? [spec.canonicalKey];
  for (const candidateKey of candidateKeys) {
    const sourceColumn = resolveSemanticDimensionSourceColumn(context.semanticContract, candidateKey);
    if (sourceColumn) {
      return sourceColumn;
    }
  }

  return null;
}

function resolveRawSourceColumn(context: DimensionResolutionContext, spec: DimensionSpec) {
  const candidates = spec.canonicalKey === "date"
    ? [...(context.datetimeColumns ?? []), ...context.categoricalColumns]
    : context.categoricalColumns;
  const aliases = [...spec.aliases, ...(spec.rawFallbackAliases ?? [])];

  const ranked = candidates
    .map((column) => ({ column, score: scoreCandidateColumn(column, aliases) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.column ?? null;
}

export function resolveExplicitDimensionSourceColumn(
  question: string,
  context: DimensionResolutionContext
): ExplicitDimensionMatch | null {
  const matches: Array<ExplicitDimensionMatch & { score: number }> = [];

  for (const spec of DIMENSION_SPECS) {
    for (const alias of spec.aliases) {
      const position = findAliasPosition(question, alias);
      if (position === null) {
        continue;
      }

      const semanticSource = resolveSemanticSourceColumn(context, spec);
      const sourceColumn = semanticSource ?? resolveRawSourceColumn(context, spec);

      if (!sourceColumn) {
        continue;
      }

      const sourceScore = semanticSource ? 5 : scoreCandidateColumn(sourceColumn, spec.aliases);
      matches.push({
        canonicalKey: spec.canonicalKey,
        sourceColumn,
        matchedAlias: alias,
        matchedPosition: position,
        score: sourceScore
      });
      break;
    }
  }

  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) => {
    if (left.matchedPosition !== right.matchedPosition) {
      return left.matchedPosition - right.matchedPosition;
    }

    if (left.score !== right.score) {
      return right.score - left.score;
    }

    return DIMENSION_SPECS.findIndex((spec) => spec.canonicalKey === left.canonicalKey) -
      DIMENSION_SPECS.findIndex((spec) => spec.canonicalKey === right.canonicalKey);
  });

  const winner = matches[0];
  return {
    canonicalKey: winner.canonicalKey,
    sourceColumn: winner.sourceColumn,
    matchedAlias: winner.matchedAlias,
    matchedPosition: winner.matchedPosition
  };
}

export function findExplicitDimensionMention(question: string): ExplicitDimensionKey | null {
  const normalizedQuestion = normalize(question);
  const matches: Array<{ canonicalKey: ExplicitDimensionKey; matchedPosition: number }> = [];

  for (const spec of DIMENSION_SPECS) {
    for (const alias of spec.aliases) {
      const position = findAliasPosition(normalizedQuestion, alias);
      if (position === null) {
        continue;
      }

      matches.push({
        canonicalKey: spec.canonicalKey,
        matchedPosition: position
      });
      break;
    }
  }

  matches.sort((left, right) => {
    if (left.matchedPosition !== right.matchedPosition) {
      return left.matchedPosition - right.matchedPosition;
    }
    return DIMENSION_SPECS.findIndex((spec) => spec.canonicalKey === left.canonicalKey) -
      DIMENSION_SPECS.findIndex((spec) => spec.canonicalKey === right.canonicalKey);
  });

  return matches[0]?.canonicalKey ?? null;
}
