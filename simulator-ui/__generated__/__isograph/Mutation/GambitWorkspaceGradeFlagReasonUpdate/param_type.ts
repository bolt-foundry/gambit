import type { Mutation__GambitWorkspaceGradeFlagReasonUpdate__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceGradeFlagReasonUpdate__param = {
  readonly data: {
    readonly workspaceGradeFlagReasonUpdate: ({
      readonly workspace: ({
        readonly id: (string | null),
        readonly gradeTab: ({
          readonly flags: (ReadonlyArray<{
            readonly id: (string | null),
            readonly refId: (string | null),
            readonly runId: (string | null),
            readonly turnIndex: (number | null),
            readonly reason: (string | null),
            readonly createdAt: (string | null),
          }> | null),
        } | null),
      } | null),
      readonly flags: (ReadonlyArray<{
        readonly id: (string | null),
        readonly refId: (string | null),
        readonly runId: (string | null),
        readonly turnIndex: (number | null),
        readonly reason: (string | null),
        readonly createdAt: (string | null),
      }> | null),
    } | null),
  },
  readonly parameters: Mutation__GambitWorkspaceGradeFlagReasonUpdate__parameters,
};
