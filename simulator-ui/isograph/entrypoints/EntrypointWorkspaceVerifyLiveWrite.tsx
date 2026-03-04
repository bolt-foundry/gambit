import { iso } from "@iso-gambit-sim";

// This entrypoint exists to type/normalize external subscription writes.
// NOTE: keep this rooted on Query for now. Isograph 0.5.x currently does not
// emit full artifacts for Subscription entrypoints (missing entrypoint.ts),
// which breaks generated route imports/codegen in this repo.
export const EntrypointWorkspaceVerifyLiveWrite = iso(`
  field Query.EntrypointWorkspaceVerifyLiveWrite($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      id
      scenarioRuns(first: 50) {
        edges {
          node {
            id
            status
            startedAt
            finishedAt
            error
          }
        }
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
              graderId
              scenarioRunId
              status
              startedAt
              finishedAt
              requested
              active
              completed
              failed
              requests(first: 50) {
                edges {
                  node {
                    id
                    status
                    runId
                    error
                  }
                }
              }
              metrics {
                sampleSize
                agreementRate
                scoreSpreadMin
                scoreSpreadMedian
                scoreSpreadMax
                instabilityCount
                verdict
                verdictReason
                outliers(first: 25) {
                  edges {
                    node {
                      key
                      label
                      sampleSize
                      agreementRate
                      scoreDelta
                      passFlip
                      instability
                      minRunId
                      maxRunId
                      turnIndex
                      messageRefId
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
