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
            startedAt?: (string | null),
            status: string,
            transcriptEntries: ReadonlyArray<{
              __typename: "WorkspaceConversationTranscriptMessage",
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
          },
        }>,
      },
    },
  },
}

