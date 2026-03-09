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
          openResponses____first___l_1: {
            edges: ReadonlyArray<{
              node: {
                id: string,
                outputItems____first___l_200: {
                  edges: ReadonlyArray<{
                    node: {
                      __typename: "OutputMessage",
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
                      messageRefId?: (string | null),
                      role: string,
                    },
                  }>,
                },
                status: string,
              },
            }>,
          },
          startedAt?: (string | null),
          status: string,
        },
      }>,
    },
  },
}

