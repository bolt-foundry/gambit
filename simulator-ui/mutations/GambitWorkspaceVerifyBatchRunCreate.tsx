import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceVerifyBatchRunCreateMutation = iso(`
  field Mutation.GambitWorkspaceVerifyBatchRunCreate(
    $input: WorkspaceVerifyBatchRunCreateInput!
  ) {
    workspaceVerifyBatchRunCreate(input: $input) {
      workspace {
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
      batch {
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
`)(function GambitWorkspaceVerifyBatchRunCreate({ data }) {
  return data.workspaceVerifyBatchRunCreate;
});

export default GambitWorkspaceVerifyBatchRunCreateMutation;
