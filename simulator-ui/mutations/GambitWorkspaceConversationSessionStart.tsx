import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceConversationSessionStartMutation = iso(`
  field Mutation.GambitWorkspaceConversationSessionStart(
    $input: WorkspaceConversationSessionStartInput!
  ) {
    workspaceConversationSessionStart(input: $input) {
      session {
        __typename
        sessionId
        status
        asWorkspaceBuildConversationSession {
          run {
            id
          }
        }
        asWorkspaceScenarioConversationSession {
          run {
            id
          }
        }
        asWorkspaceGraderConversationSession {
          gradeRun {
            id
          }
        }
        asWorkspaceVerifyConversationSession {
          verifyBatch {
            id
          }
        }
      }
      workspace {
        id
      }
    }
  }
`)(function GambitWorkspaceConversationSessionStart({ data }) {
  return data.workspaceConversationSessionStart;
});

export default GambitWorkspaceConversationSessionStartMutation;
