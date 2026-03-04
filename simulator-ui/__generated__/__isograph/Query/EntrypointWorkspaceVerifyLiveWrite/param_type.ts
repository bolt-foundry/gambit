import type { Query__EntrypointWorkspaceVerifyLiveWrite__parameters } from './parameters_type.ts';

export type Query__EntrypointWorkspaceVerifyLiveWrite__param = {
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
              readonly graderId: (string | null),
              readonly scenarioRunId: (string | null),
              readonly status: (string | null),
              readonly startedAt: (string | null),
              readonly finishedAt: (string | null),
              readonly requested: (number | null),
              readonly active: (number | null),
              readonly completed: (number | null),
              readonly failed: (number | null),
              readonly requests: ({
                readonly edges: (ReadonlyArray<({
                  readonly node: ({
                    readonly id: (string | null),
                    readonly status: (string | null),
                    readonly runId: (string | null),
                    readonly error: (string | null),
                  } | null),
                } | null)> | null),
              } | null),
              readonly metrics: ({
                readonly sampleSize: (number | null),
                readonly agreementRate: (number | null),
                readonly scoreSpreadMin: (number | null),
                readonly scoreSpreadMedian: (number | null),
                readonly scoreSpreadMax: (number | null),
                readonly instabilityCount: (number | null),
                readonly verdict: (string | null),
                readonly verdictReason: (string | null),
                readonly outliers: ({
                  readonly edges: (ReadonlyArray<({
                    readonly node: ({
                      readonly key: (string | null),
                      readonly label: (string | null),
                      readonly sampleSize: (number | null),
                      readonly agreementRate: (number | null),
                      readonly scoreDelta: (number | null),
                      readonly passFlip: (boolean | null),
                      readonly instability: (boolean | null),
                      readonly minRunId: (string | null),
                      readonly maxRunId: (string | null),
                      readonly turnIndex: (number | null),
                      readonly messageRefId: (string | null),
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
