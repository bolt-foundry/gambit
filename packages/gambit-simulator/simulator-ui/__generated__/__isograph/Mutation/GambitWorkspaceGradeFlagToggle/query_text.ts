export default 'mutation GambitWorkspaceGradeFlagToggle($input: WorkspaceGradeFlagToggleInput!) {\
  workspaceGradeFlagToggle____input___v_input: workspaceGradeFlagToggle(input: $input) {\
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