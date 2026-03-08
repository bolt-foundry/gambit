export type Query__EntrypointSimulatorVerifyPage__raw_response_type = {
  workspace____id___v_workspaceId: {
    id: string,
    scenarioDecks: ReadonlyArray<{
      id: string,
      description?: (string | null),
      label: string,
      path: string,
    }>,
    verification: {
      batches____first___l_50: {
        edges: ReadonlyArray<{
          node: {
            id: string,
            active: number,
            completed: number,
            failed: number,
            finishedAt?: (string | null),
            graderId: string,
            graderRepeatsPerScenario: number,
            metrics?: ({
              executionFailureCount: number,
              failureReasons____first___l_25: {
                edges: ReadonlyArray<{
                  node: {
                    count: number,
                    key: string,
                    kind: string,
                    reason: string,
                  },
                }>,
              },
              gradeSampleCountCompleted: number,
              gradeSampleCountFailed: number,
              gradeSampleCountRequested: number,
              gradingFailureCount: number,
              outlierScenarioRuns____first___l_25: {
                edges: ReadonlyArray<{
                  node: {
                    averageScore?: (number | null),
                    completedSampleCount: number,
                    executionFailureCount: number,
                    failed: boolean,
                    gradeSampleCount: number,
                    gradingFailureCount: number,
                    key: string,
                    maxRunId?: (string | null),
                    maxScore?: (number | null),
                    messageRefId?: (string | null),
                    minRunId?: (string | null),
                    minScore?: (number | null),
                    scenarioRunId: string,
                  },
                }>,
              },
              passRate?: (number | null),
              scenarioRunCountCompleted: number,
              scenarioRunCountFailed: number,
              scenarioRunCountRequested: number,
              scoreMax?: (number | null),
              scoreMean?: (number | null),
              scoreMedian?: (number | null),
              scoreMin?: (number | null),
            } | null),
            requested: number,
            requests____first___l_200: {
              edges: ReadonlyArray<{
                node: {
                  id: string,
                  error?: (string | null),
                  runId?: (string | null),
                  scenarioRunId?: (string | null),
                  status: string,
                },
              }>,
            },
            scenarioDeckId?: (string | null),
            scenarioRuns: number,
            scenarioRunsCompleted: number,
            scenarioRunsFailed: number,
            startedAt?: (string | null),
            status: string,
            workspaceId: string,
          },
        }>,
      },
      graderDecks____first___l_50: {
        edges: ReadonlyArray<{
          node: {
            id: string,
            description?: (string | null),
            label: string,
            path: string,
          },
        }>,
      },
    },
  },
}

