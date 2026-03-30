export default 'mutation GambitWorkspaceFeedbackSave($input: WorkspaceFeedbackSaveInput!) {\
  workspaceFeedbackSave____input___v_input: workspaceFeedbackSave(input: $input) {\
    deleted,\
    feedback {\
      id,\
      createdAt,\
      messageRefId,\
      reason,\
      runId,\
      score,\
    },\
    run {\
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