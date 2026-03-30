export type Mutation__GambitWorkspaceGradeFlagToggle__raw_response_type = {
  workspaceGradeFlagToggle____input___v_input: {
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

