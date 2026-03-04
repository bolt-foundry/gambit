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
                    },\
                  },\
                },\
                status,\
              },\
            },\
          },\
          startedAt,\
          status,\
        },\
      },\
    },\
  },\
}';