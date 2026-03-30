export type Mutation__GambitWorkspaceConversationSessionStart__raw_response_type = {
  workspaceConversationSessionStart____input___v_input: {
    session: {
      __typename: "WorkspaceBuildConversationSession",
      id: string,
      run: {
        __typename: string,
        id: string,
      },
      sessionId: string,
      status: string,
    } | {
      __typename: "WorkspaceGraderConversationSession",
      id: string,
      gradeRun: {
        id: string,
      },
      sessionId: string,
      status: string,
    } | {
      __typename: "WorkspaceScenarioConversationSession",
      id: string,
      run: {
        __typename: string,
        id: string,
      },
      sessionId: string,
      status: string,
    } | {
      __typename: "WorkspaceVerifyConversationSession",
      id: string,
      sessionId: string,
      status: string,
      verifyBatch: {
        id: string,
      },
    },
    workspace: {
      id: string,
    },
  },
}

