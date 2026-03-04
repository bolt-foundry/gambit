import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceScenarioRunStartMutation = iso(`
  field Mutation.GambitWorkspaceScenarioRunStart(
    $input: WorkspaceScenarioRunStartInput!
  ) {
    workspaceScenarioRunStart(input: $input) {
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
      }
    }
  }
`)(function GambitWorkspaceScenarioRunStart({ data }) {
  return data.workspaceScenarioRunStart;
});

export default GambitWorkspaceScenarioRunStartMutation;
