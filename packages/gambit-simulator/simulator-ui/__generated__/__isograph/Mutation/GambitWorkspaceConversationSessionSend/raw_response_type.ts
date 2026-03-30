export type Mutation__GambitWorkspaceConversationSessionSend__raw_response_type = {
  workspaceConversationSessionSend____input___v_input: {
    session: {
      __typename: "WorkspaceBuildConversationSession",
      id: string,
      run: {
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
      },
      sessionId: string,
      status: string,
    } | {
      __typename: "WorkspaceScenarioConversationSession",
      id: string,
      run: {
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
      },
      sessionId: string,
      status: string,
    },
    workspace: {
      id: string,
    },
  },
}

