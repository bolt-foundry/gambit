export type Mutation__GambitWorkspaceGradeFlagReasonUpdate__raw_response_type = {
  workspaceGradeFlagReasonUpdate____input___v_input: {
    flags: ReadonlyArray<{
      id: string,
      createdAt: string,
      reason?: (string | null),
      refId: string,
      runId?: (string | null),
      turnIndex?: (number | null),
    }>,
    workspace: {
      id: string,
      gradeTab: {
        flags: ReadonlyArray<{
          id: string,
          createdAt: string,
          reason?: (string | null),
          refId: string,
          runId?: (string | null),
          turnIndex?: (number | null),
        }>,
      },
    },
  },
}

