import { iso } from "@iso-gambit-sim";

export const GambitWorkspaceGradeRunCreateMutation = iso(`
  field Mutation.GambitWorkspaceGradeRunCreate(
    $input: WorkspaceGradeRunCreateInput!
  ) {
    workspaceGradeRunCreate(input: $input) {
      workspace {
        id
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
      run {
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
    }
  }
`)(function GambitWorkspaceGradeRunCreate({ data }) {
  return data.workspaceGradeRunCreate;
});

export default GambitWorkspaceGradeRunCreateMutation;
