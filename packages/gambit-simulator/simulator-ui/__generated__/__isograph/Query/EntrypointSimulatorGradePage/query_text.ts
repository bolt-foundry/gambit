export default 'query EntrypointSimulatorGradePage($workspaceId: ID!) {\
  workspace____id___v_workspaceId: workspace(id: $workspaceId) {\
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
    workbenchSelectedContextChips,\
  },\
}';