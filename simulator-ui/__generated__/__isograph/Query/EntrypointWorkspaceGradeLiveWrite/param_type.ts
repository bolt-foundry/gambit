import type { Query__EntrypointWorkspaceGradeLiveWrite__parameters } from './parameters_type.ts';

export type Query__EntrypointWorkspaceGradeLiveWrite__param = {
  readonly data: {
    readonly workspace: ({
      readonly id: (string | null),
      readonly scenarioRuns: ({
        readonly edges: (ReadonlyArray<({
          readonly node: ({
            readonly id: (string | null),
            readonly status: (string | null),
            readonly startedAt: (string | null),
            readonly finishedAt: (string | null),
            readonly error: (string | null),
          } | null),
        } | null)> | null),
      } | null),
      readonly gradeTab: ({
        readonly graderDecks: (ReadonlyArray<{
          readonly id: (string | null),
          readonly label: (string | null),
          readonly description: (string | null),
          readonly path: (string | null),
        }> | null),
        readonly runs: (ReadonlyArray<{
          readonly id: (string | null),
          readonly workspaceId: (string | null),
          readonly scenarioRunId: (string | null),
          readonly graderId: (string | null),
          readonly graderPath: (string | null),
          readonly graderLabel: (string | null),
          readonly status: (string | null),
          readonly runAt: (string | null),
          readonly error: (string | null),
          readonly summary: ({
            readonly score: (number | null),
            readonly reason: (string | null),
          } | null),
          readonly turns: (ReadonlyArray<{
            readonly id: (string | null),
            readonly runId: (string | null),
            readonly turnIndex: (number | null),
            readonly turnNumber: (number | null),
            readonly refId: (string | null),
            readonly score: (number | null),
            readonly reason: (string | null),
            readonly priorUser: (string | null),
            readonly gradedAssistant: (string | null),
          }> | null),
        }> | null),
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
  },
  readonly parameters: Query__EntrypointWorkspaceGradeLiveWrite__parameters,
};
