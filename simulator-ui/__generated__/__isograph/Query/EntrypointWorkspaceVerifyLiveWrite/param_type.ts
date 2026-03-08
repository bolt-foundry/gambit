import type { Query__EntrypointWorkspaceVerifyLiveWrite__parameters } from './parameters_type.ts';

export type Query__EntrypointWorkspaceVerifyLiveWrite__param = {
  readonly data: {
    readonly workspace: {
      readonly id: string,
      readonly scenarioDecks: ReadonlyArray<{
        readonly id: string,
        readonly label: string,
        readonly description: (string | null),
        readonly path: string,
      }>,
      readonly verification: {
        readonly graderDecks: {
          readonly edges: ReadonlyArray<{
            readonly node: {
              readonly id: string,
              readonly label: string,
              readonly description: (string | null),
              readonly path: string,
            },
          }>,
        },
        readonly batches: {
          readonly edges: ReadonlyArray<{
            readonly node: {
              readonly id: string,
              readonly workspaceId: string,
              readonly scenarioDeckId: (string | null),
              readonly graderId: string,
              readonly scenarioRuns: number,
              readonly graderRepeatsPerScenario: number,
              readonly status: string,
              readonly startedAt: (string | null),
              readonly finishedAt: (string | null),
              readonly requested: number,
              readonly active: number,
              readonly completed: number,
              readonly failed: number,
              readonly scenarioRunsCompleted: number,
              readonly scenarioRunsFailed: number,
              readonly requests: {
                readonly edges: ReadonlyArray<{
                  readonly node: {
                    readonly id: string,
                    readonly scenarioRunId: (string | null),
                    readonly status: string,
                    readonly runId: (string | null),
                    readonly error: (string | null),
                  },
                }>,
              },
              readonly metrics: ({
                readonly scenarioRunCountRequested: number,
                readonly scenarioRunCountCompleted: number,
                readonly scenarioRunCountFailed: number,
                readonly gradeSampleCountRequested: number,
                readonly gradeSampleCountCompleted: number,
                readonly gradeSampleCountFailed: number,
                readonly executionFailureCount: number,
                readonly gradingFailureCount: number,
                readonly passRate: (number | null),
                readonly scoreMin: (number | null),
                readonly scoreMedian: (number | null),
                readonly scoreMax: (number | null),
                readonly scoreMean: (number | null),
                readonly outlierScenarioRuns: {
                  readonly edges: ReadonlyArray<{
                    readonly node: {
                      readonly key: string,
                      readonly scenarioRunId: string,
                      readonly gradeSampleCount: number,
                      readonly completedSampleCount: number,
                      readonly executionFailureCount: number,
                      readonly gradingFailureCount: number,
                      readonly averageScore: (number | null),
                      readonly minScore: (number | null),
                      readonly maxScore: (number | null),
                      readonly failed: boolean,
                      readonly minRunId: (string | null),
                      readonly maxRunId: (string | null),
                      readonly messageRefId: (string | null),
                    },
                  }>,
                },
                readonly failureReasons: {
                  readonly edges: ReadonlyArray<{
                    readonly node: {
                      readonly key: string,
                      readonly kind: string,
                      readonly reason: string,
                      readonly count: number,
                    },
                  }>,
                },
              } | null),
            },
          }>,
        },
      },
    },
  },
  readonly parameters: Query__EntrypointWorkspaceVerifyLiveWrite__parameters,
};
