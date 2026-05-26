function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function isValidCalendarDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function toIsoDate(year: number, month: number, day: number) {
  if (!isValidCalendarDate(year, month, day)) {
    return undefined;
  }

  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

function parseYearFirstDate(value: string) {
  const match = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T\s].*)?$/);
  if (!match) {
    return undefined;
  }

  return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseDayOrMonthFirstDate(value: string, preferDayFirst: boolean) {
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T\s].*)?$/);
  if (!match) {
    return undefined;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]);

  if (first > 12 && second <= 12) {
    return toIsoDate(year, second, first);
  }

  if (second > 12 && first <= 12) {
    return toIsoDate(year, first, second);
  }

  if (first <= 12 && second <= 12) {
    return preferDayFirst ? toIsoDate(year, second, first) : undefined;
  }

  return undefined;
}

function parseIsoDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return toIsoDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

export function normalizeDateForQuestionContext(
  value?: string | number | null,
  options: { preferDayFirst?: boolean } = {}
) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const rawValue = String(value).trim();
  if (!rawValue) {
    return undefined;
  }

  const preferDayFirst = options.preferDayFirst ?? true;

  return (
    parseYearFirstDate(rawValue) ??
    parseDayOrMonthFirstDate(rawValue, preferDayFirst) ??
    parseIsoDateTime(rawValue)
  );
}
