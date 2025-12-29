export function sanitizeNumber(
  value: unknown,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
