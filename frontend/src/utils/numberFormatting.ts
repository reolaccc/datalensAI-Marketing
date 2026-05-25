export function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const absolute = Math.abs(value);
  if (absolute < 1000) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: value % 1 === 0 ? 0 : 2
    }).format(value);
  }

  const units = [
    { limit: 1_000_000_000_000, suffix: "T", divisor: 1_000_000_000_000 },
    { limit: 1_000_000_000, suffix: "B", divisor: 1_000_000_000 },
    { limit: 1_000_000, suffix: "M", divisor: 1_000_000 },
    { limit: 1_000, suffix: "K", divisor: 1_000 }
  ];

  const unit = units.find((entry) => absolute >= entry.limit) ?? units[units.length - 1];
  const scaled = value / unit.divisor;
  const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;

  return `${Number(scaled.toFixed(decimals)).toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0
  })}${unit.suffix}`;
}

export function formatCompactCurrency(value: number) {
  return `$${formatCompactNumber(value)}`;
}
