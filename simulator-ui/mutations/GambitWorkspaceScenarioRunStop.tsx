import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceScenarioRunStopMutation = iso(`
  field Mutation.GambitWorkspaceScenarioRunStop(
    $input: WorkspaceScenarioRunStopInput!
  ) {
    workspaceScenarioRunStop(input: $input) {
      workspace {
        id
        scenarioRuns(first: 25) {
          edges {
            node {
              id
              status
              startedAt
              finishedAt
              error
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
        workspaceId
        status
        startedAt
        finishedAt
        error
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
`)(function GambitWorkspaceScenarioRunStop({ data }) {
  return data.workspaceScenarioRunStop;
});

export default GambitWorkspaceScenarioRunStopMutation;
