import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceScenarioRunSendMutation = iso(`
  field Mutation.GambitWorkspaceScenarioRunSend(
    $input: WorkspaceScenarioRunSendInput!
  ) {
    workspaceScenarioRunSend(input: $input) {
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
                            messageRefId
                            role
                            content
                            feedback {
                              id
                              runId
                              messageRefId
                              score
                              reason
                              createdAt
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
                      messageRefId
                      role
                      content
                      feedback {
                        id
                        runId
                        messageRefId
                        score
                        reason
                        createdAt
                      }
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
`)(function GambitWorkspaceScenarioRunSend({ data }) {
  return data.workspaceScenarioRunSend;
});

export default GambitWorkspaceScenarioRunSendMutation;
