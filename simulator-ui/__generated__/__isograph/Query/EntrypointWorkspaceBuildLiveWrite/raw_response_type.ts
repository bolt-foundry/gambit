export type Query__EntrypointWorkspaceBuildLiveWrite__raw_response_type = {
  workspace____id___v_workspaceId: {
    id: string,
    buildRuns____first___l_1: {
      edges: ReadonlyArray<{
        node: {
          __typename: string,
          id: string,
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
          status: string,
        },
      }>,
    },
    files____first___l_200: {
      edges: ReadonlyArray<{
        node: {
          id: string,
          content?: (string | null),
          modifiedAt?: (string | null),
          path: string,
          size?: (number | null),
        },
      }>,
    },
    scenarioDecks: ReadonlyArray<{
      id: string,
      description?: (string | null),
      label: string,
      maxTurns?: (number | null),
      path: string,
    }>,
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
        },
      }>,
    },
  },
}

