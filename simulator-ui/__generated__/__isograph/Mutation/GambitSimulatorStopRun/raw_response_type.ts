export type Mutation__GambitSimulatorStopRun__raw_response_type = {
  simulatorStopRun____input___v_input: {
    run: {
      id: string,
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
                  role: string,
                } | {
                  __typename: "OutputReasoning",
                  id: string,
                  reasoningType?: (string | null),
                  summary: string,
                } | {
                  __typename: "OutputToolCall",
                  id: string,
                  argumentsText?: (string | null),
                  error?: (string | null),
                  resultText?: (string | null),
                  status: string,
                  toolCallId: string,
                  toolName: string,
                },
              }>,
            },
            status: string,
          },
        }>,
      },
      status: string,
    },
    workspace: {
      id: string,
      buildRuns____first___l_1: {
        edges: ReadonlyArray<{
          node: {
            __typename: string,
            id: string,
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
                        role: string,
                      } | {
                        __typename: "OutputReasoning",
                        id: string,
                        reasoningType?: (string | null),
                        summary: string,
                      } | {
                        __typename: "OutputToolCall",
                        id: string,
                        argumentsText?: (string | null),
                        error?: (string | null),
                        resultText?: (string | null),
                        status: string,
                        toolCallId: string,
                        toolName: string,
                      },
                    }>,
                  },
                  status: string,
                },
              }>,
            },
            status: string,
          },
        }>,
      },
    },
  },
}

