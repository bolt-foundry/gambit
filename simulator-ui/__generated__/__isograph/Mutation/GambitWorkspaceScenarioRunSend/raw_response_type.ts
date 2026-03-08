export type Mutation__GambitWorkspaceScenarioRunSend__raw_response_type = {
  workspaceScenarioRunSend____input___v_input: {
    run: {
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
                  role: string,
                } | {
                  __typename: "OutputReasoning",
                  id: string,
                  reasoningType?: (string | null),
                  summary: string,
                } | {
                  __typename: "OutputToolCall",
                  id: string,
                  argumentsText?: (string | null),
                  error?: (string | null),
                  resultText?: (string | null),
                  status: string,
                  toolCallId: string,
                  toolName: string,
                },
              }>,
            },
            status: string,
          },
        }>,
      },
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

