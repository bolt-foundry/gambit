import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceGradeFlagReasonUpdateMutation = iso(`
  field Mutation.GambitWorkspaceGradeFlagReasonUpdate(
    $input: WorkspaceGradeFlagReasonUpdateInput!
  ) {
    workspaceGradeFlagReasonUpdate(input: $input) {
      workspace {
        id
        gradeTab {
          flags {
            id
            refId
            runId
            turnIndex
            reason
            createdAt
          }
        }
      }
      flags {
        id
        refId
        runId
        turnIndex
        reason
        createdAt
      }
    }
  }
`)(function GambitWorkspaceGradeFlagReasonUpdate({ data }) {
  return data.workspaceGradeFlagReasonUpdate;
});

export default GambitWorkspaceGradeFlagReasonUpdateMutation;
