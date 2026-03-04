import { iso } from "@iso-gambit-sim";

// This entrypoint exists to type/normalize external subscription writes.
// NOTE: keep this rooted on Query for now. Isograph 0.5.x currently does not
// emit full artifacts for Subscription entrypoints (missing entrypoint.ts),
// which breaks generated route imports/codegen in this repo.
export const EntrypointWorkspaceBuildLiveWrite = iso(`
  field Query.EntrypointWorkspaceBuildLiveWrite($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      id
      scenarioDecks {
        id
        label
        description
        path
        maxTurns
      }
      files(first: 200) {
        edges {
          node {
            id
            path
            PreviewFile
          }
        }
      }
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
  }
`)(function EntrypointWorkspaceBuildLiveWrite() {
  return {
    Body: null,
    title: "Gambit Simulator",
  };
});

export default EntrypointWorkspaceBuildLiveWrite;
