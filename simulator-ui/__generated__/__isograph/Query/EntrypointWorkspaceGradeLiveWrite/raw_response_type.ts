export type Query__EntrypointWorkspaceGradeLiveWrite__raw_response_type = {
  workspace____id___v_workspaceId?: ({
    id?: string,
    gradeTab?: ({
      flags?: (ReadonlyArray<{
        id?: string,
        createdAt?: (string | null),
        reason?: (string | null),
        refId?: (string | null),
        runId?: (string | null),
        turnIndex?: (number | null),
      }> | null),
      graderDecks?: (ReadonlyArray<{
        id?: string,
        description?: (string | null),
        label?: (string | null),
        path?: (string | null),
      }> | null),
      runs?: (ReadonlyArray<{
        id?: string,
        error?: (string | null),
        graderId?: (string | null),
        graderLabel?: (string | null),
        graderPath?: (string | null),
        runAt?: (string | null),
        scenarioRunId?: (string | null),
        status?: (string | null),
        summary?: ({
          reason?: (string | null),
          score?: (number | null),
        } | null),
        turns?: (ReadonlyArray<{
          id?: string,
          gradedAssistant?: (string | null),
          priorUser?: (string | null),
          reason?: (string | null),
          refId?: (string | null),
          runId?: (string | null),
          score?: (number | null),
          turnIndex?: (number | null),
          turnNumber?: (number | null),
        }> | null),
        workspaceId?: (string | null),
      }> | null),
    } | null),
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
  } | null),
}

