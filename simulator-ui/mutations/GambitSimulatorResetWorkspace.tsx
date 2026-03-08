import { iso } from "@iso-gambit-sim";

export const GambitSimulatorResetWorkspaceMutation = iso(`
  field Mutation.GambitSimulatorResetWorkspace(
    $input: SimulatorResetWorkspaceInput!
  ) {
    simulatorResetWorkspace(input: $input) {
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
      build {
        workspaceId
        runStatus
        canSend
        canStop
      }
    }
  }
`)(function GambitSimulatorResetWorkspace({ data }) {
  return data.simulatorResetWorkspace;
});

export default GambitSimulatorResetWorkspaceMutation;
