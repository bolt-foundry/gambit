export default 'mutation GambitWorkspaceGradeFlagReasonUpdate($input: WorkspaceGradeFlagReasonUpdateInput!) {\
  workspaceGradeFlagReasonUpdate____input___v_input: workspaceGradeFlagReasonUpdate(input: $input) {\
    flags {\
      id,\
      createdAt,\
      reason,\
      refId,\
      runId,\
      turnIndex,\
    },\
    workspace {\
      id,\
      gradeTab {\
        flags {\
          id,\
          createdAt,\
          reason,\
          refId,\
          runId,\
          turnIndex,\
        },\
      },\
    },\
  },\
}';