import type { Nominal } from "./utility_types.ts";

export type GambitID = Nominal<string, "GambitID">;
export type GambitRunID = Nominal<string, "GambitRunID">;
export type GambitStreamID = Nominal<string, "GambitStreamID">;

export function asGambitID(value: string): GambitID {
  return value as GambitID;
}

export function asGambitRunID(value: string): GambitRunID {
  return value as GambitRunID;
}

export function asGambitStreamID(value: string): GambitStreamID {
  return value as GambitStreamID;
}
