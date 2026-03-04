export default 'mutation GambitWorkspaceVerifyBatchRunCreate($input: WorkspaceVerifyBatchRunCreateInput!) {\
  workspaceVerifyBatchRunCreate____input___v_input: workspaceVerifyBatchRunCreate(input: $input) {\
    batch {\
      id,\
      active,\
      completed,\
      failed,\
      finishedAt,\
      graderId,\
      metrics {\
        agreementRate,\
        instabilityCount,\
        outliers____first___l_25: outliers(first: 25) {\
          edges {\
            node {\
              agreementRate,\
              instability,\
              key,\
              label,\
              maxRunId,\
              messageRefId,\
              minRunId,\
              passFlip,\
              sampleSize,\
              scoreDelta,\
              turnIndex,\
            },\
          },\
        },\
        sampleSize,\
        scoreSpreadMax,\
        scoreSpreadMedian,\
        scoreSpreadMin,\
        verdict,\
        verdictReason,\
      },\
      requested,\
      requests____first___l_50: requests(first: 50) {\
        edges {\
          node {\
            id,\
            error,\
            runId,\
            status,\
          },\
        },\
      },\
      scenarioRunId,\
      startedAt,\
      status,\
      workspaceId,\
    },\
    workspace {\
      id,\
      scenarioRuns____first___l_50: scenarioRuns(first: 50) {\
        edges {\
          node {\
            __typename,\
            id,\
            error,\
            finishedAt,\
            startedAt,\
            status,\
          },\
        },\
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
              metrics {\
                agreementRate,\
                instabilityCount,\
                outliers____first___l_25: outliers(first: 25) {\
                  edges {\
                    node {\
                      agreementRate,\
                      instability,\
                      key,\
                      label,\
                      maxRunId,\
                      messageRefId,\
                      minRunId,\
                      passFlip,\
                      sampleSize,\
                      scoreDelta,\
                      turnIndex,\
                    },\
                  },\
                },\
                sampleSize,\
                scoreSpreadMax,\
                scoreSpreadMedian,\
                scoreSpreadMin,\
                verdict,\
                verdictReason,\
              },\
              requested,\
              requests____first___l_50: requests(first: 50) {\
                edges {\
                  node {\
                    id,\
                    error,\
                    runId,\
                    status,\
                  },\
                },\
              },\
              scenarioRunId,\
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