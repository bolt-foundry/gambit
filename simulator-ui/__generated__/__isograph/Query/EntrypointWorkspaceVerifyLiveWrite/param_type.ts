import type { Query__EntrypointWorkspaceVerifyLiveWrite__parameters } from './parameters_type.ts';

export type Query__EntrypointWorkspaceVerifyLiveWrite__param = {
  readonly data: {
    readonly workspace: ({
      readonly id: (string | null),
      readonly scenarioDecks: (ReadonlyArray<{
        readonly id: (string | null),
        readonly label: (string | null),
        readonly description: (string | null),
        readonly path: (string | null),
      }> | null),
      readonly verification: ({
        readonly graderDecks: ({
          readonly edges: (ReadonlyArray<({
            readonly node: ({
              readonly id: (string | null),
              readonly label: (string | null),
              readonly description: (string | null),
              readonly path: (string | null),
            } | null),
          } | null)> | null),
        } | null),
        readonly batches: ({
          readonly edges: (ReadonlyArray<({
            readonly node: ({
              readonly id: (string | null),
              readonly workspaceId: (string | null),
              readonly scenarioDeckId: (string | null),
              readonly graderId: (string | null),
              readonly scenarioRuns: (number | null),
              readonly graderRepeatsPerScenario: (number | null),
              readonly status: (string | null),
              readonly startedAt: (string | null),
              readonly finishedAt: (string | null),
              readonly requested: (number | null),
              readonly active: (number | null),
              readonly completed: (number | null),
              readonly failed: (number | null),
              readonly scenarioRunsCompleted: (number | null),
              readonly scenarioRunsFailed: (number | null),
              readonly requests: ({
                readonly edges: (ReadonlyArray<({
                  readonly node: ({
                    readonly id: (string | null),
                    readonly scenarioRunId: (string | null),
                    readonly status: (string | null),
                    readonly runId: (string | null),
                    readonly error: (string | null),
                  } | null),
                } | null)> | null),
              } | null),
              readonly metrics: ({
                readonly scenarioRunCountRequested: (number | null),
                readonly scenarioRunCountCompleted: (number | null),
                readonly scenarioRunCountFailed: (number | null),
                readonly gradeSampleCountRequested: (number | null),
                readonly gradeSampleCountCompleted: (number | null),
                readonly gradeSampleCountFailed: (number | null),
                readonly executionFailureCount: (number | null),
                readonly gradingFailureCount: (number | null),
                readonly passRate: (number | null),
                readonly scoreMin: (number | null),
                readonly scoreMedian: (number | null),
                readonly scoreMax: (number | null),
                readonly scoreMean: (number | null),
                readonly outlierScenarioRuns: ({
                  readonly edges: (ReadonlyArray<({
                    readonly node: ({
                      readonly key: (string | null),
                      readonly scenarioRunId: (string | null),
                      readonly gradeSampleCount: (number | null),
                      readonly completedSampleCount: (number | null),
                      readonly executionFailureCount: (number | null),
                      readonly gradingFailureCount: (number | null),
                      readonly averageScore: (number | null),
                      readonly minScore: (number | null),
                      readonly maxScore: (number | null),
                      readonly failed: (boolean | null),
                      readonly minRunId: (string | null),
                      readonly maxRunId: (string | null),
                      readonly messageRefId: (string | null),
                    } | null),
                  } | null)> | null),
                } | null),
                readonly failureReasons: ({
                  readonly edges: (ReadonlyArray<({
                    readonly node: ({
                      readonly key: (string | null),
                      readonly kind: (string | null),
                      readonly reason: (string | null),
                      readonly count: (number | null),
                    } | null),
                  } | null)> | null),
                } | null),
              } | null),
            } | null),
          } | null)> | null),
        } | null),
      } | null),
    } | null),
  },
  readonly parameters: Query__EntrypointWorkspaceVerifyLiveWrite__parameters,
};
