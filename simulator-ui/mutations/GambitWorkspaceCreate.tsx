import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceCreateMutation = iso(`
  field Mutation.GambitWorkspaceCreate {
    gambitWorkspaceCreate {
      workspace {
        id
      }
      workspaces(first: 200) {
        edges {
          node {
            id
            deck
            deckSlug
            testBotName
            createdAt
            sessionDir
            statePath
          }
        }
      }
    }
  }
`)(function GambitWorkspaceCreate({ data }) {
  return data.gambitWorkspaceCreate;
});

export default GambitWorkspaceCreateMutation;
