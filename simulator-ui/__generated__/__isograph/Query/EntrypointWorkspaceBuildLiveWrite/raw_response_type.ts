export type Query__EntrypointWorkspaceBuildLiveWrite__raw_response_type = {
  workspace____id___v_workspaceId?: ({
    id?: string,
    buildRuns____first___l_1?: ({
      edges?: (ReadonlyArray<({
        node?: ({
          __typename: string,
          id?: string,
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
                    } | {
                      __typename: "OutputReasoning",
                      id?: string,
                      reasoningType?: (string | null),
                      summary?: (string | null),
                    } | {
                      __typename: "OutputToolCall",
                      id?: string,
                      argumentsText?: (string | null),
                      error?: (string | null),
                      resultText?: (string | null),
                      status?: (string | null),
                      toolCallId?: (string | null),
                      toolName?: (string | null),
                    } | null),
                  } | null)> | null),
                } | null),
                status?: (string | null),
              } | null),
            } | null)> | null),
          } | null),
          status?: (string | null),
        } | null),
      } | null)> | null),
    } | null),
    files____first___l_200?: ({
      edges?: (ReadonlyArray<({
        node?: ({
          id?: string,
          content?: (string | null),
          modifiedAt?: (string | null),
          path?: (string | null),
          size?: (number | null),
        } | null),
      } | null)> | null),
    } | null),
    scenarioDecks?: (ReadonlyArray<{
      id?: string,
      description?: (string | null),
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
                    } | {
                      __typename: "OutputReasoning",
                      id?: string,
                      reasoningType?: (string | null),
                      summary?: (string | null),
                    } | {
                      __typename: "OutputToolCall",
                      id?: string,
                      argumentsText?: (string | null),
                      error?: (string | null),
                      resultText?: (string | null),
                      status?: (string | null),
                      toolCallId?: (string | null),
                      toolName?: (string | null),
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

