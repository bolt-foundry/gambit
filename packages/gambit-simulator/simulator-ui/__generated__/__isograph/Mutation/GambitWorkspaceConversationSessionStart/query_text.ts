export default 'mutation GambitWorkspaceConversationSessionStart($input: WorkspaceConversationSessionStartInput!) {\
  workspaceConversationSessionStart____input___v_input: workspaceConversationSessionStart(input: $input) {\
    session {\
      __typename,\
      id,\
      sessionId,\
      status,\
      ... on WorkspaceBuildConversationSession {\
        __typename,\
        id,\
        run {\
          __typename,\
          id,\
        },\
      },\
      ... on WorkspaceGraderConversationSession {\
        __typename,\
        id,\
        gradeRun {\
          id,\
        },\
      },\
      ... on WorkspaceScenarioConversationSession {\
        __typename,\
        id,\
        run {\
          __typename,\
          id,\
        },\
      },\
      ... on WorkspaceVerifyConversationSession {\
        __typename,\
        id,\
        verifyBatch {\
          id,\
        },\
      },\
    },\
    workspace {\
      id,\
    },\
  },\
}';