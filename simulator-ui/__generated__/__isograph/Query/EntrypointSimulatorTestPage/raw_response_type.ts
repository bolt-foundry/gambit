export type Query__EntrypointSimulatorTestPage__raw_response_type = {
  workspace____id___v_workspaceId?: ({
    id?: string,
    assistantDeck?: ({
      deck?: (string | null),
      defaults?: (string | null),
      inputSchema?: (string | null),
      inputSchemaError?: (string | null),
      modelParams?: (string | null),
      startMode?: (string | null),
      tools?: (string | null),
    } | null),
    scenarioDecks?: (ReadonlyArray<{
      id?: string,
      defaults?: (string | null),
      description?: (string | null),
      inputSchema?: (string | null),
      inputSchemaError?: (string | null),
      label?: (string | null),
      maxTurns?: (number | null),
      path?: (string | null),
    }> | null),
    scenarioRuns____first___l_25?: ({
      edges?: (ReadonlyArray<({
        node?: ({
          __typename: string,
          id?: string,
          error?: (string | null),
          finishedAt?: (string | null),
          openResponses____first___l_1?: ({
            edges?: (ReadonlyArray<({
              node?: ({
                id?: string,
                outputItems____first___l_200?: ({
                  edges?: (ReadonlyArray<({
                    node?: ({
                      __typename: "OutputMessage",
                      id?: string,
                      content?: (string | null),
                      role?: (string | null),
                    } | null),
                  } | null)> | null),
                } | null),
                status?: (string | null),
              } | null),
            } | null)> | null),
          } | null),
          startedAt?: (string | null),
          status?: (string | null),
        } | null),
      } | null)> | null),
    } | null),
  } | null),
}

