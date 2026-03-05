export type Mutation__GambitWorkspaceConversationSessionStart__raw_response_type = {
  workspaceConversationSessionStart____input___v_input?: ({
    session?: ({
      __typename: "WorkspaceBuildConversationSession",
      id?: string,
      run?: ({
        __typename: string,
        id?: string,
      } | null),
      sessionId?: (string | null),
      status?: (string | null),
    } | {
      __typename: "WorkspaceGraderConversationSession",
      id?: string,
      gradeRun?: ({
        id?: string,
      } | null),
      sessionId?: (string | null),
      status?: (string | null),
    } | {
      __typename: "WorkspaceScenarioConversationSession",
      id?: string,
      run?: ({
        __typename: string,
        id?: string,
      } | null),
      sessionId?: (string | null),
      status?: (string | null),
    } | {
      __typename: "WorkspaceVerifyConversationSession",
      id?: string,
      sessionId?: (string | null),
      status?: (string | null),
      verifyBatch?: ({
        id?: string,
      } | null),
    } | null),
    workspace?: ({
      id?: string,
    } | null),
  } | null),
}

