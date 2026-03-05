import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceConversationSessionStopMutation = iso(`
  field Mutation.GambitWorkspaceConversationSessionStop(
    $input: WorkspaceConversationSessionStopInput!
  ) {
    workspaceConversationSessionStop(input: $input) {
      session {
        __typename
        sessionId
        status
        asWorkspaceBuildConversationSession {
          run {
            id
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
        asWorkspaceScenarioConversationSession {
          run {
            id
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
      workspace {
        id
      }
    }
  }
`)(function GambitWorkspaceConversationSessionStop({ data }) {
  return data.workspaceConversationSessionStop;
});

export default GambitWorkspaceConversationSessionStopMutation;
