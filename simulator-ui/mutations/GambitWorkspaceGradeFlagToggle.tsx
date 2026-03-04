import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceGradeFlagToggleMutation = iso(`
  field Mutation.GambitWorkspaceGradeFlagToggle(
    $input: WorkspaceGradeFlagToggleInput!
  ) {
    workspaceGradeFlagToggle(input: $input) {
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
`)(function GambitWorkspaceGradeFlagToggle({ data }) {
  return data.workspaceGradeFlagToggle;
});

export default GambitWorkspaceGradeFlagToggleMutation;
