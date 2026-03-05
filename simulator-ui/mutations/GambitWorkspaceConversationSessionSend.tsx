import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceConversationSessionSendMutation = iso(`
  field Mutation.GambitWorkspaceConversationSessionSend(
    $input: WorkspaceConversationSessionSendInput!
  ) {
    workspaceConversationSessionSend(input: $input) {
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
`)(function GambitWorkspaceConversationSessionSend({ data }) {
  return data.workspaceConversationSessionSend;
});

export default GambitWorkspaceConversationSessionSendMutation;
