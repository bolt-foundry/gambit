export type Mutation__GambitSimulatorStopRun__raw_response_type = {
  simulatorStopRun____input___v_input: {
    run: {
      id: string,
      error?: (string | null),
      openResponses____first___l_1: {
        edges: ReadonlyArray<{
          node: {
            id: string,
            status: string,
          },
        }>,
      },
      startedAt?: (string | null),
      status: string,
      transcriptEntries: ReadonlyArray<{
        __typename: "WorkspaceConversationTranscriptMessage",
        id: string,
        content: string,
        feedbackEligible: boolean,
        messageRefId?: (string | null),
        role: string,
      } | {
        __typename: "WorkspaceConversationTranscriptReasoning",
        id: string,
        reasoningType?: (string | null),
        summary: string,
      } | {
        __typename: "WorkspaceConversationTranscriptToolCall",
        id: string,
        argumentsText?: (string | null),
        error?: (string | null),
        resultText?: (string | null),
        status: string,
        toolCallId: string,
        toolName: string,
      }>,
      workspaceId: string,
    },
    workspace: {
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
                  status: string,
                },
              }>,
            },
            startedAt?: (string | null),
            status: string,
            transcriptEntries: ReadonlyArray<{
              __typename: "WorkspaceConversationTranscriptMessage",
              id: string,
              content: string,
              feedbackEligible: boolean,
              messageRefId?: (string | null),
              role: string,
            } | {
              __typename: "WorkspaceConversationTranscriptReasoning",
              id: string,
              reasoningType?: (string | null),
              summary: string,
            } | {
              __typename: "WorkspaceConversationTranscriptToolCall",
              id: string,
              argumentsText?: (string | null),
              error?: (string | null),
              resultText?: (string | null),
              status: string,
              toolCallId: string,
              toolName: string,
            }>,
            workspaceId: string,
          },
        }>,
      },
    },
  },
}

