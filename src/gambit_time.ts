import type { Nominal } from "./utility_types.ts";

export type GambitISODateTime = Nominal<string, "GambitISODateTime">;

export function asGambitISODateTime(value: string): GambitISODateTime {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO datetime: ${value}`);
  }
  return value as GambitISODateTime;
}

export function toDate(value: GambitISODateTime): Date {
  return new Date(value);
}
