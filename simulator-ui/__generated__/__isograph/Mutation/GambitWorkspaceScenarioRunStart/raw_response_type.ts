export type Mutation__GambitWorkspaceScenarioRunStart__raw_response_type = {
  workspaceScenarioRunStart____input___v_input: {
    run: {
      id: string,
      error?: (string | null),
      finishedAt?: (string | null),
      startedAt?: (string | null),
      status: string,
      workspaceId: string,
    },
    workspace: {
      id: string,
      scenarioRuns____first___l_25: {
        edges: ReadonlyArray<{
          node: {
            __typename: string,
            id: string,
            error?: (string | null),
            finishedAt?: (string | null),
            openResponses____first___l_1: {
              edges: ReadonlyArray<{
                node: {
                  id: string,
                  outputItems____first___l_200: {
                    edges: ReadonlyArray<{
                      node: {
                        __typename: "OutputMessage",
                        id: string,
                        content: string,
                        feedback?: ({
                          id: string,
                          createdAt?: (string | null),
                          messageRefId: string,
                          reason?: (string | null),
                          runId: string,
                          score: number,
                        } | null),
                        messageRefId?: (string | null),
                        role: string,
                      },
                    }>,
                  },
                  status: string,
                },
              }>,
            },
            startedAt?: (string | null),
            status: string,
          },
        }>,
      },
    },
  },
}

