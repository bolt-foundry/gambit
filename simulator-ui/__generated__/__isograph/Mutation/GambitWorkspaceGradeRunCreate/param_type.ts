import type { Mutation__GambitWorkspaceGradeRunCreate__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceGradeRunCreate__param = {
  readonly data: {
    readonly workspaceGradeRunCreate: {
      readonly workspace: {
        readonly id: string,
        readonly gradeTab: {
          readonly graderDecks: ReadonlyArray<{
            readonly id: string,
            readonly label: string,
            readonly description: (string | null),
            readonly path: string,
          }>,
          readonly runs: ReadonlyArray<{
            readonly id: string,
            readonly workspaceId: string,
            readonly scenarioRunId: (string | null),
            readonly graderId: string,
            readonly graderPath: string,
            readonly graderLabel: (string | null),
            readonly status: string,
            readonly runAt: (string | null),
            readonly error: (string | null),
            readonly summary: ({
              readonly score: (number | null),
              readonly reason: (string | null),
            } | null),
            readonly turns: ReadonlyArray<{
              readonly id: string,
              readonly runId: string,
              readonly turnIndex: number,
              readonly turnNumber: number,
              readonly refId: string,
              readonly score: (number | null),
              readonly reason: (string | null),
              readonly priorUser: (string | null),
              readonly gradedAssistant: (string | null),
            }>,
          }>,
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
      readonly run: {
        readonly id: string,
        readonly workspaceId: string,
        readonly scenarioRunId: (string | null),
        readonly graderId: string,
        readonly graderPath: string,
        readonly graderLabel: (string | null),
        readonly status: string,
        readonly runAt: (string | null),
        readonly error: (string | null),
        readonly summary: ({
          readonly score: (number | null),
          readonly reason: (string | null),
        } | null),
        readonly turns: ReadonlyArray<{
          readonly id: string,
          readonly runId: string,
          readonly turnIndex: number,
          readonly turnNumber: number,
          readonly refId: string,
          readonly score: (number | null),
          readonly reason: (string | null),
          readonly priorUser: (string | null),
          readonly gradedAssistant: (string | null),
        }>,
      },
    },
  },
  readonly parameters: Mutation__GambitWorkspaceGradeRunCreate__parameters,
};
