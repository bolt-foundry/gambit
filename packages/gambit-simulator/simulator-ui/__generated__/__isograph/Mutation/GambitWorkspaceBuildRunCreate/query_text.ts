export default 'mutation GambitWorkspaceBuildRunCreate($input: WorkspaceBuildRunCreateInput!) {\
  workspaceBuildRunCreate____input___v_input: workspaceBuildRunCreate(input: $input) {\
    run {\
      id,\
      error,\
      openResponses____first___l_1: openResponses(first: 1) {\
        edges {\
          node {\
            id,\
            status,\
          },\
        },\
      },\
      startedAt,\
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
      workspaceId,\
    },\
    workspace {\
      id,\
      buildRuns____first___l_1: buildRuns(first: 1) {\
        edges {\
          node {\
            __typename,\
            id,\
            error,\
            openResponses____first___l_1: openResponses(first: 1) {\
              edges {\
                node {\
                  id,\
                  status,\
                },\
              },\
            },\
            startedAt,\
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
            workspaceId,\
          },\
        },\
      },\
    },\
  },\
}';