export default 'query EntrypointSimulatorWorkspaceShell($workspaceId: ID!) {\
  gambitWorkspaces____first___l_200: gambitWorkspaces(first: 200) {\
    edges {\
      node {\
        id,\
        createdAt,\
        deck,\
        deckSlug,\
        sessionDir,\
        statePath,\
        testBotName,\
      },\
    },\
  },\
  workspace____id___v_workspaceId: workspace(id: $workspaceId) {\
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
    models {\
      codex {\
        available,\
        loggedIn,\
        model,\
        requiresLogin,\
        statusText,\
        trustedPath,\
        workspaceId,\
        writeEnabled,\
      },\
    },\
  },\
}';