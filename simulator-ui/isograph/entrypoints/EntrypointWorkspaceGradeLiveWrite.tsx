import { iso } from "@iso-gambit-sim";

// This entrypoint exists to type/normalize external subscription writes.
// NOTE: keep this rooted on Query for now. Isograph 0.5.x currently does not
// emit full artifacts for Subscription entrypoints (missing entrypoint.ts),
// which breaks generated route imports/codegen in this repo.
export const EntrypointWorkspaceGradeLiveWrite = iso(`
  field Query.EntrypointWorkspaceGradeLiveWrite($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      id
      scenarioRuns(first: 50) {
        edges {
          node {
            id
            status
            startedAt
            finishedAt
            error
          }
        }
      }
      gradeTab {
        graderDecks {
          id
          label
          description
          path
        }
        runs {
          id
          workspaceId
          scenarioRunId
          graderId
          graderPath
          graderLabel
          status
          runAt
          error
          summary {
            score
            reason
          }
          turns {
            id
            runId
            turnIndex
            turnNumber
            refId
            score
            reason
            priorUser
            gradedAssistant
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
  }
`)(function EntrypointWorkspaceGradeLiveWrite() {
  return {
    Body: null,
    title: "Gambit Simulator",
  };
});

export default EntrypointWorkspaceGradeLiveWrite;
