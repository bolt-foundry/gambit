export default 'mutation GambitWorkspaceScenarioRunStart($input: WorkspaceScenarioRunStartInput!) {\
  workspaceScenarioRunStart____input___v_input: workspaceScenarioRunStart(input: $input) {\
    run {\
      id,\
      error,\
      finishedAt,\
      startedAt,\
      status,\
      workspaceId,\
    },\
    workspace {\
      id,\
      scenarioRuns____first___l_25: scenarioRuns(first: 25) {\
        edges {\
          node {\
            __typename,\
            id,\
            error,\
            finishedAt,\
            openResponses____first___l_1: openResponses(first: 1) {\
              edges {\
                node {\
                  id,\
                  outputItems____first___l_200: outputItems(first: 200) {\
                    edges {\
                      node {\
                        __typename,\
                        ... on OutputMessage {\
                          __typename,\
                          id,\
                          content,\
                          feedback {\
                            id,\
                            createdAt,\
                            messageRefId,\
                            reason,\
                            runId,\
                            score,\
                          },\
                          messageRefId,\
                          role,\
                        },\
                      },\
                    },\
                  },\
                  status,\
                },\
              },\
            },\
            startedAt,\
            status,\
          },\
        },\
      },\
    },\
  },\
}';