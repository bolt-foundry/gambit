export type Mutation__GambitWorkspaceScenarioRunStop__raw_response_type = {
  workspaceScenarioRunStop____input___v_input?: ({
    run?: ({
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
      workspaceId?: (string | null),
    } | null),
    workspace?: ({
      id?: string,
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
  } | null),
}

