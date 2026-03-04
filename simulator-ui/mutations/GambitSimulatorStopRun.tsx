import { iso } from "@iso-gambit-sim";

export const GambitSimulatorStopRunMutation = iso(`
  field Mutation.GambitSimulatorStopRun(
    $input: SimulatorStopRunInput!
  ) {
    simulatorStopRun(input: $input) {
      workspace {
        id
        buildRuns(first: 1) {
          edges {
            node {
              id
              status
              openResponses(first: 1) {
                edges {
                  node {
                    id
                    status
                    outputItems(first: 200) {
                      edges {
                        node {
                          __typename
                          asOutputMessage {
                            id
                            role
                            content
                          }
                          asOutputReasoning {
                            id
                            summary
                            reasoningType
                          }
                          asOutputToolCall {
                            id
                            toolCallId
                            toolName
                            status
                            argumentsText
                            resultText
                            error
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      run {
        id
        status
        openResponses(first: 1) {
          edges {
            node {
              id
              status
              outputItems(first: 200) {
                edges {
                  node {
                    __typename
                    asOutputMessage {
                      id
                      role
                      content
                    }
                    asOutputReasoning {
                      id
                      summary
                      reasoningType
                    }
                    asOutputToolCall {
                      id
                      toolCallId
                      toolName
                      status
                      argumentsText
                      resultText
                      error
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`)(function GambitSimulatorStopRun({ data }) {
  return data.simulatorStopRun;
});

export default GambitSimulatorStopRunMutation;
