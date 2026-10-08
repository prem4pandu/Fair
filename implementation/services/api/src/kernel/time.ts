export function isoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function epochMillisString(
  value: Date | null | undefined,
): string | null {
  return value ? String(value.getTime()) : null;
}

export function parseClientDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
