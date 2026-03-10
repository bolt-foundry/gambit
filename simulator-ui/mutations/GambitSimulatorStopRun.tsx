import { iso } from "@iso-gambit-sim";

export const GambitSimulatorStopRunMutation = iso(`
  field Mutation.GambitSimulatorStopRun(
    $input: SimulatorStopRunInput!
  ) {
    simulatorStopRun(input: $input) {
      workspace {
        id
        buildRuns(first: 1) {
          edges {
            node {
              id
              workspaceId
              status
              error
              startedAt
              openResponses(first: 1) {
                edges {
                  node {
                    id
                    status
                  }
                }
              }
              transcriptEntries {
                asWorkspaceConversationTranscriptMessage {
                  id
                  role
                  content
                  messageRefId
                  feedbackEligible
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
        error
        startedAt
        openResponses(first: 1) {
          edges {
            node {
              id
              status
            }
          }
        }
        transcriptEntries {
          asWorkspaceConversationTranscriptMessage {
            id
            role
            content
            messageRefId
            feedbackEligible
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
`)(function GambitSimulatorStopRun({ data }) {
  return data.simulatorStopRun;
});

export default GambitSimulatorStopRunMutation;
