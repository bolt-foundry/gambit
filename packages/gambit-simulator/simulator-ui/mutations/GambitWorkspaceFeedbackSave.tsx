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
`)(function GambitWorkspaceFeedbackSave({ data }) {
  return data.workspaceFeedbackSave;
});

export default GambitWorkspaceFeedbackSaveMutation;
