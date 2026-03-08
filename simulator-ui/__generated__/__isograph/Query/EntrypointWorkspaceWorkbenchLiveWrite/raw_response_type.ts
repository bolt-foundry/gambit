export type Query__EntrypointWorkspaceWorkbenchLiveWrite__raw_response_type = {
  workspace____id___v_workspaceId: {
    id: string,
    buildRuns____first___l_1: {
      edges: ReadonlyArray<{
        node: {
          __typename: string,
          id: string,
          error?: (string | null),
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
      }>,
    },
    models: {
      codex: {
        available: boolean,
        loggedIn: boolean,
        model: string,
        requiresLogin: boolean,
        statusText: string,
        trustedPath?: (string | null),
        workspaceId: string,
        writeEnabled: boolean,
      },
    },
  },
}

