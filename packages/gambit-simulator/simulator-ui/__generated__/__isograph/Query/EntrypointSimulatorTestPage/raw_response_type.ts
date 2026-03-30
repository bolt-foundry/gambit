export type Query__EntrypointSimulatorTestPage__raw_response_type = {
  workspace____id___v_workspaceId: {
    id: string,
    assistantDeck?: ({
      deck?: (string | null),
      defaults?: (string | null),
      inputSchema?: (string | null),
      inputSchemaError?: (string | null),
      modelParams?: (string | null),
      startMode?: (string | null),
      tools?: (string | null),
    } | null),
    scenarioDecks: ReadonlyArray<{
      id: string,
      defaults?: (string | null),
      description?: (string | null),
      inputSchema?: (string | null),
      inputSchemaError?: (string | null),
      label: string,
      maxTurns?: (number | null),
      path: string,
    }>,
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
    sqlitePath?: (string | null),
    workbenchSelectedContextChips: string,
  },
}

