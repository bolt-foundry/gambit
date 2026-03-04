export type Query__EntrypointSimulatorWorkspaceShell__raw_response_type = {
  gambitWorkspaces____first___l_200?: ({
    edges?: (ReadonlyArray<({
      node?: ({
        id?: string,
        createdAt?: (string | null),
        deck?: (string | null),
        deckSlug?: (string | null),
        sessionDir?: (string | null),
        statePath?: (string | null),
        testBotName?: (string | null),
      } | null),
    } | null)> | null),
  } | null),
  workspace____id___v_workspaceId?: ({
    id?: string,
    buildRuns____first___l_1?: ({
      edges?: (ReadonlyArray<({
        node?: ({
          __typename: string,
          id?: string,
          error?: (string | null),
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
          workspaceId?: (string | null),
        } | null),
      } | null)> | null),
    } | null),
    models?: ({
      codex?: ({
        available?: (boolean | null),
        loggedIn?: (boolean | null),
        model?: (string | null),
        requiresLogin?: (boolean | null),
        statusText?: (string | null),
        trustedPath?: (string | null),
        workspaceId?: (string | null),
        writeEnabled?: (boolean | null),
      } | null),
    } | null),
  } | null),
}

