import type {NormalizationAst} from '@isograph/react';
const normalizationAst: NormalizationAst = {
  kind: "NormalizationAst",
  selections: [
    {
      kind: "Linked",
      fieldName: "workspace",
      arguments: [
        [
          "id",
          { kind: "Variable", name: "workspaceId" },
        ],
      ],
      concreteType: "Workspace",
      selections: [
        {
          kind: "Scalar",
          fieldName: "id",
          arguments: null,
        },
        {
          kind: "Linked",
          fieldName: "assistantDeck",
          arguments: null,
          concreteType: "WorkspaceAssistantDeck",
          selections: [
            {
              kind: "Scalar",
              fieldName: "deck",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "defaults",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "inputSchema",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "inputSchemaError",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "modelParams",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "startMode",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "tools",
              arguments: null,
            },
          ],
        },
        {
          kind: "Linked",
          fieldName: "scenarioDecks",
          arguments: null,
          concreteType: "WorkspaceScenarioDeck",
          selections: [
            {
              kind: "Scalar",
              fieldName: "id",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "defaults",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "description",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "inputSchema",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "inputSchemaError",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "label",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "maxTurns",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "path",
              arguments: null,
            },
          ],
        },
        {
          kind: "Linked",
          fieldName: "scenarioRuns",
          arguments: [
            [
              "first",
              { kind: "Literal", value: 25 },
            ],
          ],
          concreteType: "WorkspaceScenarioRunsConnection",
          selections: [
            {
              kind: "Linked",
              fieldName: "edges",
              arguments: null,
              concreteType: "WorkspaceScenarioRunsConnectionEdge",
              selections: [
                {
                  kind: "Linked",
                  fieldName: "node",
                  arguments: null,
                  concreteType: null,
                  selections: [
                    {
                      kind: "Scalar",
                      fieldName: "__typename",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "id",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "error",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "finishedAt",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "startedAt",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "status",
                      arguments: null,
                    },
                    {
                      kind: "Linked",
                      fieldName: "transcriptEntries",
                      arguments: null,
                      concreteType: null,
                      selections: [
                        {
                          kind: "Scalar",
                          fieldName: "__typename",
                          arguments: null,
                        },
                        {
                          kind: "InlineFragment",
                          type: "WorkspaceConversationTranscriptMessage",
                          selections: [
                            {
                              kind: "Scalar",
                              fieldName: "__typename",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "id",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "content",
                              arguments: null,
                            },
                            {
                              kind: "Linked",
                              fieldName: "feedback",
                              arguments: null,
                              concreteType: "Feedback",
                              selections: [
                                {
                                  kind: "Scalar",
                                  fieldName: "id",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "createdAt",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "messageRefId",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "reason",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "runId",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "score",
                                  arguments: null,
                                },
                              ],
                            },
                            {
                              kind: "Scalar",
                              fieldName: "feedbackEligible",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "messageRefId",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "role",
                              arguments: null,
                            },
                          ],
                        },
                        {
                          kind: "InlineFragment",
                          type: "WorkspaceConversationTranscriptReasoning",
                          selections: [
                            {
                              kind: "Scalar",
                              fieldName: "__typename",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "id",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "reasoningType",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "summary",
                              arguments: null,
                            },
                          ],
                        },
                        {
                          kind: "InlineFragment",
                          type: "WorkspaceConversationTranscriptToolCall",
                          selections: [
                            {
                              kind: "Scalar",
                              fieldName: "__typename",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "id",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "argumentsText",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "error",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "resultText",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "status",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "toolCallId",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "toolName",
                              arguments: null,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          kind: "Scalar",
          fieldName: "sqlitePath",
          arguments: null,
        },
        {
          kind: "Scalar",
          fieldName: "workbenchSelectedContextChips",
          arguments: null,
        },
      ],
    },
  ],
};
export default normalizationAst;
