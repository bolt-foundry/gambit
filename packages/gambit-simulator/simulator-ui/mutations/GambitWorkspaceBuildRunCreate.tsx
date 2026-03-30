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
`)(function GambitWorkspaceBuildRunCreate({ data }) {
  return data.workspaceBuildRunCreate;
});

export default GambitWorkspaceBuildRunCreateMutation;
