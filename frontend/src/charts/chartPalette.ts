export const CHART_PALETTE = [
  "#d4af5a",
  "#5d8f96",
  "#8aa086",
  "#b98557",
  "#6f86b6",
  "#9c7aa5",
  "#c07c68",
  "#7d94a3"
];

export const COMPOSITION_PALETTE = [
  "#d4af5a",
  "#5d8f96",
  "#8aa086",
  "#b98557",
  "#6f86b6",
  "#9c7aa5",
  "#c07c68",
  "#7d94a3"
];

export const AXIS_COLOR = "#7ea8a5";
export const GRID_COLOR = "rgba(126, 168, 165, 0.12)";
export const OTHER_CATEGORY_COLOR = "#72808b";
export const SINGLE_SERIES_COMPARISON_COLOR = "#d4af5a";
export const SINGLE_SERIES_COMPARISON_HOVER_COLOR = "#e2c06b";
export const SINGLE_SERIES_COMPARISON_MUTED_COLOR = "#b8923f";

function normalizeKey(key?: string | null) {
  return String(key ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COLOR_KEY_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  {
    canonical: "revenue",
    aliases: ["revenue", "sales value", "sales", "sales value", "income", "gmv", "net sales", "gross sales", "conversion value"]
  },
  {
    canonical: "spend",
    aliases: ["spend", "cost", "all in spend", "total outlay", "ad spend", "media spend", "paid media cost", "budget"]
  },
  {
    canonical: "clicks",
    aliases: ["clicks", "click count", "click through count"]
  },
  {
    canonical: "impressions",
    aliases: ["impressions", "impression count", "ad view count"]
  },
  {
    canonical: "conversions",
    aliases: ["conversions", "conversion count", "closed won count", "orders", "purchases"]
  },
  {
    canonical: "roas",
    aliases: ["roas", "return on ad spend"]
  },
  {
    canonical: "ctr",
    aliases: ["ctr", "click through rate", "click-through rate"]
  },
  {
    canonical: "cvr",
    aliases: ["cvr", "conversion rate", "conversion_rate"]
  }
];

function normalizeColorKey(key?: string | null) {
  const normalized = normalizeKey(key);
  if (!normalized) {
    return "";
  }

  if (normalized === "other") {
    return "other";
  }

  for (const entry of COLOR_KEY_ALIASES) {
    if (entry.aliases.some((alias) => normalized === normalizeKey(alias))) {
      return entry.canonical;
    }
  }

  return normalized;
}

export function getChartColorForKey(key?: string | null) {
  const normalized = normalizeColorKey(key);
  if (!normalized) {
    return COMPOSITION_PALETTE[0];
  }

  if (normalized === "other") {
    return OTHER_CATEGORY_COLOR;
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }

  return COMPOSITION_PALETTE[hash % COMPOSITION_PALETTE.length];
}

export function getCompositionColor(index: number, key?: string | null) {
  const normalized = normalizeColorKey(key);
  if (normalized === "other") {
    return OTHER_CATEGORY_COLOR;
  }

  return COMPOSITION_PALETTE[index % COMPOSITION_PALETTE.length];
}
