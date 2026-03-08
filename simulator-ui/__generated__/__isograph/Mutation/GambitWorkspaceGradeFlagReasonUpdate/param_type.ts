import type { Mutation__GambitWorkspaceGradeFlagReasonUpdate__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceGradeFlagReasonUpdate__param = {
  readonly data: {
    readonly workspaceGradeFlagReasonUpdate: {
      readonly workspace: {
        readonly id: string,
        readonly gradeTab: {
          readonly flags: ReadonlyArray<{
            readonly id: string,
            readonly refId: string,
            readonly runId: (string | null),
            readonly turnIndex: (number | null),
            readonly reason: (string | null),
            readonly createdAt: string,
          }>,
        },
      },
      readonly flags: ReadonlyArray<{
        readonly id: string,
        readonly refId: string,
        readonly runId: (string | null),
        readonly turnIndex: (number | null),
        readonly reason: (string | null),
        readonly createdAt: string,
      }>,
    },
  },
  readonly parameters: Mutation__GambitWorkspaceGradeFlagReasonUpdate__parameters,
};
