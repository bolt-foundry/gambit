import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceFeedbackSaveMutation = iso(`
  field Mutation.GambitWorkspaceFeedbackSave(
    $input: WorkspaceFeedbackSaveInput!
  ) {
    workspaceFeedbackSave(input: $input) {
      deleted
      feedback {
        id
        runId
        messageRefId
        score
        reason
        createdAt
      }
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
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`)(function GambitWorkspaceFeedbackSave({ data }) {
  return data.workspaceFeedbackSave;
});

export default GambitWorkspaceFeedbackSaveMutation;
