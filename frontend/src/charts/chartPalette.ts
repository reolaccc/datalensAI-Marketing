export const CHART_PALETTE = [
  "#ff6b6b",
  "#ff8e72",
  "#f7b267",
  "#f9d56e",
  "#7bd389",
  "#57cc99",
  "#38a3a5",
  "#5aa9e6"
];

export const AXIS_COLOR = "#7ea8a5";
export const GRID_COLOR = "rgba(126, 168, 165, 0.12)";

function normalizeKey(key?: string | null) {
  return String(key ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getChartColorForKey(key?: string | null) {
  const normalized = normalizeKey(key);
  if (!normalized) {
    return CHART_PALETTE[0];
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }

  return CHART_PALETTE[hash % CHART_PALETTE.length];
}
