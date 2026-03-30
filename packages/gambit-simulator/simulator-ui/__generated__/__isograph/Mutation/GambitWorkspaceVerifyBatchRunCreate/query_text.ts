export default 'mutation GambitWorkspaceVerifyBatchRunCreate($input: WorkspaceVerifyBatchRunCreateInput!) {\
  workspaceVerifyBatchRunCreate____input___v_input: workspaceVerifyBatchRunCreate(input: $input) {\
    batch {\
      id,\
      active,\
      completed,\
      failed,\
      finishedAt,\
      graderId,\
      graderRepeatsPerScenario,\
      metrics {\
        executionFailureCount,\
        failureReasons____first___l_25: failureReasons(first: 25) {\
          edges {\
            node {\
              count,\
              key,\
              kind,\
              reason,\
            },\
          },\
        },\
        gradeSampleCountCompleted,\
        gradeSampleCountFailed,\
        gradeSampleCountRequested,\
        gradingFailureCount,\
        outlierScenarioRuns____first___l_25: outlierScenarioRuns(first: 25) {\
          edges {\
            node {\
              averageScore,\
              completedSampleCount,\
              executionFailureCount,\
              failed,\
              gradeSampleCount,\
              gradingFailureCount,\
              key,\
              maxRunId,\
              maxScore,\
              messageRefId,\
              minRunId,\
              minScore,\
              scenarioRunId,\
            },\
          },\
        },\
        passRate,\
        scenarioRunCountCompleted,\
        scenarioRunCountFailed,\
        scenarioRunCountRequested,\
        scoreMax,\
        scoreMean,\
        scoreMedian,\
        scoreMin,\
      },\
      requested,\
      requests____first___l_200: requests(first: 200) {\
        edges {\
          node {\
            id,\
            error,\
            runId,\
            scenarioRunId,\
            status,\
          },\
        },\
      },\
      scenarioDeckId,\
      scenarioRuns,\
      scenarioRunsCompleted,\
      scenarioRunsFailed,\
      startedAt,\
      status,\
      workspaceId,\
    },\
    workspace {\
      id,\
      scenarioDecks {\
        id,\
        description,\
        label,\
        path,\
      },\
      verification {\
        batches____first___l_50: batches(first: 50) {\
          edges {\
            node {\
              id,\
              active,\
              completed,\
              failed,\
              finishedAt,\
              graderId,\
              graderRepeatsPerScenario,\
              metrics {\
                executionFailureCount,\
                failureReasons____first___l_25: failureReasons(first: 25) {\
                  edges {\
                    node {\
                      count,\
                      key,\
                      kind,\
                      reason,\
                    },\
                  },\
                },\
                gradeSampleCountCompleted,\
                gradeSampleCountFailed,\
                gradeSampleCountRequested,\
                gradingFailureCount,\
                outlierScenarioRuns____first___l_25: outlierScenarioRuns(first: 25) {\
                  edges {\
                    node {\
                      averageScore,\
                      completedSampleCount,\
                      executionFailureCount,\
                      failed,\
                      gradeSampleCount,\
                      gradingFailureCount,\
                      key,\
                      maxRunId,\
                      maxScore,\
                      messageRefId,\
                      minRunId,\
                      minScore,\
                      scenarioRunId,\
                    },\
                  },\
                },\
                passRate,\
                scenarioRunCountCompleted,\
                scenarioRunCountFailed,\
                scenarioRunCountRequested,\
                scoreMax,\
                scoreMean,\
                scoreMedian,\
                scoreMin,\
              },\
              requested,\
              requests____first___l_200: requests(first: 200) {\
                edges {\
                  node {\
                    id,\
                    error,\
                    runId,\
                    scenarioRunId,\
                    status,\
                  },\
                },\
              },\
              scenarioDeckId,\
              scenarioRuns,\
              scenarioRunsCompleted,\
              scenarioRunsFailed,\
              startedAt,\
              status,\
              workspaceId,\
            },\
          },\
        },\
        graderDecks____first___l_50: graderDecks(first: 50) {\
          edges {\
            node {\
              id,\
              description,\
              label,\
              path,\
            },\
          },\
        },\
      },\
    },\
  },\
}';