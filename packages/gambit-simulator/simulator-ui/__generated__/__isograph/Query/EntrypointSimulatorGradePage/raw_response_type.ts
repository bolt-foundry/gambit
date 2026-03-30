export type Query__EntrypointSimulatorGradePage__raw_response_type = {
  workspace____id___v_workspaceId: {
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
      graderDecks: ReadonlyArray<{
        id: string,
        description?: (string | null),
        label: string,
        path: string,
      }>,
      runs: ReadonlyArray<{
        id: string,
        error?: (string | null),
        graderId: string,
        graderLabel?: (string | null),
        graderPath: string,
        runAt?: (string | null),
        scenarioRunId?: (string | null),
        status: string,
        summary?: ({
          reason?: (string | null),
          score?: (number | null),
        } | null),
        turns: ReadonlyArray<{
          id: string,
          gradedAssistant?: (string | null),
          priorUser?: (string | null),
          reason?: (string | null),
          refId: string,
          runId: string,
          score?: (number | null),
          turnIndex: number,
          turnNumber: number,
        }>,
        workspaceId: string,
      }>,
    },
    scenarioRuns____first___l_50: {
      edges: ReadonlyArray<{
        node: {
          __typename: string,
          id: string,
          error?: (string | null),
          finishedAt?: (string | null),
          startedAt?: (string | null),
          status: string,
        },
      }>,
    },
    workbenchSelectedContextChips: string,
  },
}

