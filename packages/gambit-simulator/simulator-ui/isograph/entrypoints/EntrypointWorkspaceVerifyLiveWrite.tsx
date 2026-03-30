import { iso } from "@iso-gambit-sim";

// This entrypoint exists to type/normalize external subscription writes.
// NOTE: keep this rooted on Query for now. Isograph 0.5.x currently does not
// emit full artifacts for Subscription entrypoints (missing entrypoint.ts),
// which breaks generated route imports/codegen in this repo.
export const EntrypointWorkspaceVerifyLiveWrite = iso(`
  field Query.EntrypointWorkspaceVerifyLiveWrite($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      id
      scenarioDecks {
        id
        label
        description
        path
      }
      verification {
        graderDecks(first: 50) {
          edges {
            node {
              id
              label
              description
              path
            }
          }
        }
        batches(first: 50) {
          edges {
            node {
              id
              workspaceId
              scenarioDeckId
              graderId
              scenarioRuns
              graderRepeatsPerScenario
              status
              startedAt
              finishedAt
              requested
              active
              completed
              failed
              scenarioRunsCompleted
              scenarioRunsFailed
              requests(first: 200) {
                edges {
                  node {
                    id
                    scenarioRunId
                    status
                    runId
                    error
                  }
                }
              }
              metrics {
                scenarioRunCountRequested
                scenarioRunCountCompleted
                scenarioRunCountFailed
                gradeSampleCountRequested
                gradeSampleCountCompleted
                gradeSampleCountFailed
                executionFailureCount
                gradingFailureCount
                passRate
                scoreMin
                scoreMedian
                scoreMax
                scoreMean
                outlierScenarioRuns(first: 25) {
                  edges {
                    node {
                      key
                      scenarioRunId
                      gradeSampleCount
                      completedSampleCount
                      executionFailureCount
                      gradingFailureCount
                      averageScore
                      minScore
                      maxScore
                      failed
                      minRunId
                      maxRunId
                      messageRefId
                    }
                  }
                }
                failureReasons(first: 25) {
                  edges {
                    node {
                      key
                      kind
                      reason
                      count
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`)(function EntrypointWorkspaceVerifyLiveWrite() {
  return {
    Body: null,
    title: "Gambit Simulator",
  };
});

export default EntrypointWorkspaceVerifyLiveWrite;
