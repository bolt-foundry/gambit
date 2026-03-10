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
              transcriptEntries {
                asWorkspaceConversationTranscriptMessage {
                  id
                  messageRefId
                  feedbackEligible
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
                asWorkspaceConversationTranscriptReasoning {
                  id
                  summary
                  reasoningType
                }
                asWorkspaceConversationTranscriptToolCall {
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
