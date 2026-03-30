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
              transcriptEntries {
                asWorkspaceConversationTranscriptMessage {
                  id
                  messageRefId
                  feedbackEligible
                  role
                  content
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
        transcriptEntries {
          asWorkspaceConversationTranscriptMessage {
            id
            messageRefId
            feedbackEligible
            role
            content
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
`)(function GambitWorkspaceScenarioRunStop({ data }) {
  return data.workspaceScenarioRunStop;
});

export default GambitWorkspaceScenarioRunStopMutation;
