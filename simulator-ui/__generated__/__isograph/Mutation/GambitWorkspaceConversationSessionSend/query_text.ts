export default 'mutation GambitWorkspaceConversationSessionSend($input: WorkspaceConversationSessionSendInput!) {\
  workspaceConversationSessionSend____input___v_input: workspaceConversationSessionSend(input: $input) {\
    session {\
      __typename,\
      id,\
      sessionId,\
      status,\
      ... on WorkspaceBuildConversationSession {\
        __typename,\
        id,\
        run {\
          __typename,\
          id,\
          openResponses____first___l_1: openResponses(first: 1) {\
            edges {\
              node {\
                id,\
                outputItems____first___l_200: outputItems(first: 200) {\
                  edges {\
                    node {\
                      __typename,\
                      ... on OutputMessage {\
                        __typename,\
                        id,\
                        content,\
                        role,\
                      },\
                      ... on OutputReasoning {\
                        __typename,\
                        id,\
                        reasoningType,\
                        summary,\
                      },\
                      ... on OutputToolCall {\
                        __typename,\
                        id,\
                        argumentsText,\
                        error,\
                        resultText,\
                        status,\
                        toolCallId,\
                        toolName,\
                      },\
                    },\
                  },\
                },\
                status,\
              },\
            },\
          },\
        },\
      },\
      ... on WorkspaceScenarioConversationSession {\
        __typename,\
        id,\
        run {\
          __typename,\
          id,\
          openResponses____first___l_1: openResponses(first: 1) {\
            edges {\
              node {\
                id,\
                outputItems____first___l_200: outputItems(first: 200) {\
                  edges {\
                    node {\
                      __typename,\
                      ... on OutputMessage {\
                        __typename,\
                        id,\
                        content,\
                        role,\
                      },\
                      ... on OutputReasoning {\
                        __typename,\
                        id,\
                        reasoningType,\
                        summary,\
                      },\
                      ... on OutputToolCall {\
                        __typename,\
                        id,\
                        argumentsText,\
                        error,\
                        resultText,\
                        status,\
                        toolCallId,\
                        toolName,\
                      },\
                    },\
                  },\
                },\
                status,\
              },\
            },\
          },\
        },\
      },\
    },\
    workspace {\
      id,\
    },\
  },\
}';