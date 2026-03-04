export type Mutation__GambitWorkspaceVerifyBatchRunCreate__raw_response_type = {
  workspaceVerifyBatchRunCreate____input___v_input?: ({
    batch?: ({
      id?: string,
      active?: (number | null),
      completed?: (number | null),
      failed?: (number | null),
      finishedAt?: (string | null),
      graderId?: (string | null),
      metrics?: ({
        agreementRate?: (number | null),
        instabilityCount?: (number | null),
        outliers____first___l_25?: ({
          edges?: (ReadonlyArray<({
            node?: ({
              agreementRate?: (number | null),
              instability?: (boolean | null),
              key?: (string | null),
              label?: (string | null),
              maxRunId?: (string | null),
              messageRefId?: (string | null),
              minRunId?: (string | null),
              passFlip?: (boolean | null),
              sampleSize?: (number | null),
              scoreDelta?: (number | null),
              turnIndex?: (number | null),
            } | null),
          } | null)> | null),
        } | null),
        sampleSize?: (number | null),
        scoreSpreadMax?: (number | null),
        scoreSpreadMedian?: (number | null),
        scoreSpreadMin?: (number | null),
        verdict?: (string | null),
        verdictReason?: (string | null),
      } | null),
      requested?: (number | null),
      requests____first___l_50?: ({
        edges?: (ReadonlyArray<({
          node?: ({
            id?: string,
            error?: (string | null),
            runId?: (string | null),
            status?: (string | null),
          } | null),
        } | null)> | null),
      } | null),
      scenarioRunId?: (string | null),
      startedAt?: (string | null),
      status?: (string | null),
      workspaceId?: (string | null),
    } | null),
    workspace?: ({
      id?: string,
      scenarioRuns____first___l_50?: ({
        edges?: (ReadonlyArray<({
          node?: ({
            __typename: string,
            id?: string,
            error?: (string | null),
            finishedAt?: (string | null),
            startedAt?: (string | null),
            status?: (string | null),
          } | null),
        } | null)> | null),
      } | null),
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
              metrics?: ({
                agreementRate?: (number | null),
                instabilityCount?: (number | null),
                outliers____first___l_25?: ({
                  edges?: (ReadonlyArray<({
                    node?: ({
                      agreementRate?: (number | null),
                      instability?: (boolean | null),
                      key?: (string | null),
                      label?: (string | null),
                      maxRunId?: (string | null),
                      messageRefId?: (string | null),
                      minRunId?: (string | null),
                      passFlip?: (boolean | null),
                      sampleSize?: (number | null),
                      scoreDelta?: (number | null),
                      turnIndex?: (number | null),
                    } | null),
                  } | null)> | null),
                } | null),
                sampleSize?: (number | null),
                scoreSpreadMax?: (number | null),
                scoreSpreadMedian?: (number | null),
                scoreSpreadMin?: (number | null),
                verdict?: (string | null),
                verdictReason?: (string | null),
              } | null),
              requested?: (number | null),
              requests____first___l_50?: ({
                edges?: (ReadonlyArray<({
                  node?: ({
                    id?: string,
                    error?: (string | null),
                    runId?: (string | null),
                    status?: (string | null),
                  } | null),
                } | null)> | null),
              } | null),
              scenarioRunId?: (string | null),
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

