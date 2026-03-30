import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceVerifyBatchRunCreateMutation = iso(`
  field Mutation.GambitWorkspaceVerifyBatchRunCreate(
    $input: WorkspaceVerifyBatchRunCreateInput!
  ) {
    workspaceVerifyBatchRunCreate(input: $input) {
      workspace {
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
      batch {
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
`)(function GambitWorkspaceVerifyBatchRunCreate({ data }) {
  return data.workspaceVerifyBatchRunCreate;
});

export default GambitWorkspaceVerifyBatchRunCreateMutation;
