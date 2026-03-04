import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceBuildRunCreateMutation = iso(`
  field Mutation.GambitWorkspaceBuildRunCreate(
    $input: WorkspaceBuildRunCreateInput!
  ) {
    workspaceBuildRunCreate(input: $input) {
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
`)(function GambitWorkspaceBuildRunCreate({ data }) {
  return data.workspaceBuildRunCreate;
});

export default GambitWorkspaceBuildRunCreateMutation;
