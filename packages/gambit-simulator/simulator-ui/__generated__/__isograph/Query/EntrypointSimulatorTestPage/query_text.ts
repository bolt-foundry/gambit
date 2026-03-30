export default 'query EntrypointSimulatorTestPage($workspaceId: ID!) {\
  workspace____id___v_workspaceId: workspace(id: $workspaceId) {\
    id,\
    assistantDeck {\
      deck,\
      defaults,\
      inputSchema,\
      inputSchemaError,\
      modelParams,\
      startMode,\
      tools,\
    },\
    scenarioDecks {\
      id,\
      defaults,\
      description,\
      inputSchema,\
      inputSchemaError,\
      label,\
      maxTurns,\
      path,\
    },\
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
    sqlitePath,\
    workbenchSelectedContextChips,\
  },\
}';