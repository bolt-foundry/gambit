import type { Nominal } from "./utility_types.ts";

export type GambitWorkspaceRelativePath = Nominal<
  string,
  "GambitWorkspaceRelativePath"
>;

export function asGambitWorkspaceRelativePath(
  value: string,
): GambitWorkspaceRelativePath {
  return value as GambitWorkspaceRelativePath;
}
