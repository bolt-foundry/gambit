import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceDeleteMutation = iso(`
  field Mutation.GambitWorkspaceDelete($workspaceId: ID!) {
    gambitWorkspaceDelete(workspaceId: $workspaceId) {
      deleted
      error
    }
  }
`)(function GambitWorkspaceDelete({ data }) {
  return data.gambitWorkspaceDelete;
});

export default GambitWorkspaceDeleteMutation;
