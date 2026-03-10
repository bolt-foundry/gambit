export default 'mutation GambitWorkspaceScenarioRunStart($input: WorkspaceScenarioRunStartInput!) {\
  workspaceScenarioRunStart____input___v_input: workspaceScenarioRunStart(input: $input) {\
    run {\
      id,\
      error,\
      finishedAt,\
      startedAt,\
      status,\
      workspaceId,\
    },\
    workspace {\
      id,\
      scenarioRuns____first___l_25: scenarioRuns(first: 25) {\
        edges {\
          node {\
            __typename,\
            id,\
            error,\
            finishedAt,\
            startedAt,\
            status,\
            transcriptEntries {\
              __typename,\
              ... on WorkspaceConversationTranscriptMessage {\
                __typename,\
                id,\
                content,\
                feedback {\
                  id,\
                  createdAt,\
                  messageRefId,\
                  reason,\
                  runId,\
                  score,\
                },\
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