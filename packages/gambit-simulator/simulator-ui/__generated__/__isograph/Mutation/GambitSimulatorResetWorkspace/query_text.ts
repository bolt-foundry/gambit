export default 'mutation GambitSimulatorResetWorkspace($input: SimulatorResetWorkspaceInput!) {\
  simulatorResetWorkspace____input___v_input: simulatorResetWorkspace(input: $input) {\
    build {\
      canSend,\
      canStop,\
      runStatus,\
      workspaceId,\
    },\
    workspace {\
      id,\
      buildRuns____first___l_1: buildRuns(first: 1) {\
        edges {\
          node {\
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
            status,\
            transcriptEntries {\
              __typename,\
              ... on WorkspaceConversationTranscriptMessage {\
                __typename,\
                id,\
                content,\
                feedbackEligible,\
                messageRefId,\
                role,\
              },\
              ... on WorkspaceConversationTranscriptReasoning {\
                __typename,\
                id,\
                reasoningType,\
                summary,\
              },\
              ... on WorkspaceConversationTranscriptToolCall {\
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
      },\
    },\
  },\
}';