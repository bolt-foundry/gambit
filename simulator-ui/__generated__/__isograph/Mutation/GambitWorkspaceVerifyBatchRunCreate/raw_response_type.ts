export type Mutation__GambitWorkspaceVerifyBatchRunCreate__raw_response_type = {
  workspaceVerifyBatchRunCreate____input___v_input?: ({
    batch?: ({
      id?: string,
      active?: (number | null),
      completed?: (number | null),
      failed?: (number | null),
      finishedAt?: (string | null),
      graderId?: (string | null),
      graderRepeatsPerScenario?: (number | null),
      metrics?: ({
        executionFailureCount?: (number | null),
        failureReasons____first___l_25?: ({
          edges?: (ReadonlyArray<({
            node?: ({
              count?: (number | null),
              key?: (string | null),
              kind?: (string | null),
              reason?: (string | null),
            } | null),
          } | null)> | null),
        } | null),
        gradeSampleCountCompleted?: (number | null),
        gradeSampleCountFailed?: (number | null),
        gradeSampleCountRequested?: (number | null),
        gradingFailureCount?: (number | null),
        outlierScenarioRuns____first___l_25?: ({
          edges?: (ReadonlyArray<({
            node?: ({
              averageScore?: (number | null),
              completedSampleCount?: (number | null),
              executionFailureCount?: (number | null),
              failed?: (boolean | null),
              gradeSampleCount?: (number | null),
              gradingFailureCount?: (number | null),
              key?: (string | null),
              maxRunId?: (string | null),
              maxScore?: (number | null),
              messageRefId?: (string | null),
              minRunId?: (string | null),
              minScore?: (number | null),
              scenarioRunId?: (string | null),
            } | null),
          } | null)> | null),
        } | null),
        passRate?: (number | null),
        scenarioRunCountCompleted?: (number | null),
        scenarioRunCountFailed?: (number | null),
        scenarioRunCountRequested?: (number | null),
        scoreMax?: (number | null),
        scoreMean?: (number | null),
        scoreMedian?: (number | null),
        scoreMin?: (number | null),
      } | null),
      requested?: (number | null),
      requests____first___l_200?: ({
        edges?: (ReadonlyArray<({
          node?: ({
            id?: string,
            error?: (string | null),
            runId?: (string | null),
            scenarioRunId?: (string | null),
            status?: (string | null),
          } | null),
        } | null)> | null),
      } | null),
      scenarioDeckId?: (string | null),
      scenarioRuns?: (number | null),
      scenarioRunsCompleted?: (number | null),
      scenarioRunsFailed?: (number | null),
      startedAt?: (string | null),
      status?: (string | null),
      workspaceId?: (string | null),
    } | null),
    workspace?: ({
      id?: string,
      scenarioDecks?: (ReadonlyArray<{
        id?: string,
        description?: (string | null),
        label?: (string | null),
        path?: (string | null),
      }> | null),
      verification?: ({
        batches____first___l_50?: ({
          edges?: (ReadonlyArray<({
            node?: ({
              id?: string,
              active?: (number | null),
              completed?: (number | null),
              failed?: (number | null),
              finishedAt?: (string | null),
              graderId?: (string | null),
              graderRepeatsPerScenario?: (number | null),
              metrics?: ({
                executionFailureCount?: (number | null),
                failureReasons____first___l_25?: ({
                  edges?: (ReadonlyArray<({
                    node?: ({
                      count?: (number | null),
                      key?: (string | null),
                      kind?: (string | null),
                      reason?: (string | null),
                    } | null),
                  } | null)> | null),
                } | null),
                gradeSampleCountCompleted?: (number | null),
                gradeSampleCountFailed?: (number | null),
                gradeSampleCountRequested?: (number | null),
                gradingFailureCount?: (number | null),
                outlierScenarioRuns____first___l_25?: ({
                  edges?: (ReadonlyArray<({
                    node?: ({
                      averageScore?: (number | null),
                      completedSampleCount?: (number | null),
                      executionFailureCount?: (number | null),
                      failed?: (boolean | null),
                      gradeSampleCount?: (number | null),
                      gradingFailureCount?: (number | null),
                      key?: (string | null),
                      maxRunId?: (string | null),
                      maxScore?: (number | null),
                      messageRefId?: (string | null),
                      minRunId?: (string | null),
                      minScore?: (number | null),
                      scenarioRunId?: (string | null),
                    } | null),
                  } | null)> | null),
                } | null),
                passRate?: (number | null),
                scenarioRunCountCompleted?: (number | null),
                scenarioRunCountFailed?: (number | null),
                scenarioRunCountRequested?: (number | null),
                scoreMax?: (number | null),
                scoreMean?: (number | null),
                scoreMedian?: (number | null),
                scoreMin?: (number | null),
              } | null),
              requested?: (number | null),
              requests____first___l_200?: ({
                edges?: (ReadonlyArray<({
                  node?: ({
                    id?: string,
                    error?: (string | null),
                    runId?: (string | null),
                    scenarioRunId?: (string | null),
                    status?: (string | null),
                  } | null),
                } | null)> | null),
              } | null),
              scenarioDeckId?: (string | null),
              scenarioRuns?: (number | null),
              scenarioRunsCompleted?: (number | null),
              scenarioRunsFailed?: (number | null),
              startedAt?: (string | null),
              status?: (string | null),
              workspaceId?: (string | null),
            } | null),
          } | null)> | null),
        } | null),
        graderDecks____first___l_50?: ({
          edges?: (ReadonlyArray<({
            node?: ({
              id?: string,
              description?: (string | null),
              label?: (string | null),
              path?: (string | null),
            } | null),
          } | null)> | null),
        } | null),
      } | null),
    } | null),
  } | null),
}

