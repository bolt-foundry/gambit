export type Mutation__GambitWorkspaceGradeFlagReasonUpdate__raw_response_type = {
  workspaceGradeFlagReasonUpdate____input___v_input?: ({
    flags?: (ReadonlyArray<{
      id?: string,
      createdAt?: (string | null),
      reason?: (string | null),
      refId?: (string | null),
      runId?: (string | null),
      turnIndex?: (number | null),
    }> | null),
    workspace?: ({
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
      } | null),
    } | null),
  } | null),
}

