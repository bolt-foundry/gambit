export default 'mutation GambitWorkspaceGradeRunCreate($input: WorkspaceGradeRunCreateInput!) {\
  workspaceGradeRunCreate____input___v_input: workspaceGradeRunCreate(input: $input) {\
    run {\
      id,\
      error,\
      graderId,\
      graderLabel,\
      graderPath,\
      runAt,\
      scenarioRunId,\
      status,\
      summary {\
        reason,\
        score,\
      },\
      turns {\
        id,\
        gradedAssistant,\
        priorUser,\
        reason,\
        refId,\
        runId,\
        score,\
        turnIndex,\
        turnNumber,\
      },\
      workspaceId,\
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
        graderDecks {\
          id,\
          description,\
          label,\
          path,\
        },\
        runs {\
          id,\
          error,\
          graderId,\
          graderLabel,\
          graderPath,\
          runAt,\
          scenarioRunId,\
          status,\
          summary {\
            reason,\
            score,\
          },\
          turns {\
            id,\
            gradedAssistant,\
            priorUser,\
            reason,\
            refId,\
            runId,\
            score,\
            turnIndex,\
            turnNumber,\
          },\
          workspaceId,\
        },\
      },\
    },\
  },\
}';