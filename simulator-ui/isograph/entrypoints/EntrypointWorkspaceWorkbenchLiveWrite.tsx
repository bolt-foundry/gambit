import { iso } from "@iso-gambit-sim";

// This entrypoint exists to type/normalize external subscription writes.
// NOTE: keep this rooted on Query for now. Isograph 0.5.x currently does not
// emit full artifacts for Subscription entrypoints (missing entrypoint.ts),
// which breaks generated route imports/codegen in this repo.
export const EntrypointWorkspaceWorkbenchLiveWrite = iso(`
  field Query.EntrypointWorkspaceWorkbenchLiveWrite($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      id
      models {
        codex {
          model
          workspaceId
          available
          requiresLogin
          loggedIn
          statusText
          trustedPath
          writeEnabled
        }
      }
      buildRuns(first: 1) {
        edges {
          node {
            id
            WorkbenchConversationRunChat
          }
        }
      }
    }
  }
`)(function EntrypointWorkspaceWorkbenchLiveWrite() {
  return {
    Body: null,
    title: "Gambit Simulator",
  };
});

export default EntrypointWorkspaceWorkbenchLiveWrite;
