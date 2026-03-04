import { iso } from "@iso-gambit-sim";

// This entrypoint exists to type/normalize external subscription writes.
// NOTE: keep this rooted on Query for now. Isograph 0.5.x currently does not
// emit full artifacts for Subscription entrypoints (missing entrypoint.ts),
// which breaks generated route imports/codegen in this repo.
export const EntrypointWorkspaceBuildTabLiveWrite = iso(`
  field Query.EntrypointWorkspaceBuildTabLiveWrite($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      id
      files(first: 200) {
        edges {
          node {
            id
            path
            PreviewFile
          }
        }
      }
    }
  }
`)(function EntrypointWorkspaceBuildTabLiveWrite() {
  return {
    Body: null,
    title: "Gambit Simulator",
  };
});

export default EntrypointWorkspaceBuildTabLiveWrite;
