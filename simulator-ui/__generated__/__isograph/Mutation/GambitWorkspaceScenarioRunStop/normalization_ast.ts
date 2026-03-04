import type {NormalizationAst} from '@isograph/react';
const normalizationAst: NormalizationAst = {
  kind: "NormalizationAst",
  selections: [
    {
      kind: "Linked",
      fieldName: "workspaceScenarioRunStop",
      arguments: [
        [
          "input",
          { kind: "Variable", name: "input" },
        ],
      ],
      concreteType: "WorkspaceScenarioRunStopPayload",
      selections: [
        {
          kind: "Linked",
          fieldName: "run",
          arguments: null,
          concreteType: "WorkspaceScenarioRun",
          selections: [
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
              kind: "Linked",
              fieldName: "openResponses",
              arguments: [
                [
                  "first",
                  { kind: "Literal", value: 1 },
                ],
              ],
              concreteType: "WorkspaceConversationRunOpenResponsesConnection",
              selections: [
                {
                  kind: "Linked",
                  fieldName: "edges",
                  arguments: null,
                  concreteType: "WorkspaceConversationRunOpenResponsesConnectionEdge",
                  selections: [
                    {
                      kind: "Linked",
                      fieldName: "node",
                      arguments: null,
                      concreteType: "OpenResponse",
                      selections: [
                        {
                          kind: "Scalar",
                          fieldName: "id",
                          arguments: null,
                        },
                        {
                          kind: "Linked",
                          fieldName: "outputItems",
                          arguments: [
                            [
                              "first",
                              { kind: "Literal", value: 200 },
                            ],
                          ],
                          concreteType: "OpenResponseOutputItemsConnection",
                          selections: [
                            {
                              kind: "Linked",
                              fieldName: "edges",
                              arguments: null,
                              concreteType: "OpenResponseOutputItemsConnectionEdge",
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
                                      kind: "InlineFragment",
                                      type: "OutputMessage",
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
                                          kind: "Scalar",
                                          fieldName: "role",
                                          arguments: null,
                                        },
                                      ],
                                    },
                                    {
                                      kind: "InlineFragment",
                                      type: "OutputReasoning",
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
                                      type: "OutputToolCall",
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
                        {
                          kind: "Scalar",
                          fieldName: "status",
                          arguments: null,
                        },
                      ],
                    },
                  ],
                },
              ],
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
              kind: "Scalar",
              fieldName: "workspaceId",
              arguments: null,
            },
          ],
        },
        {
          kind: "Linked",
          fieldName: "workspace",
          arguments: null,
          concreteType: "Workspace",
          selections: [
            {
              kind: "Scalar",
              fieldName: "id",
              arguments: null,
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
                          kind: "Linked",
                          fieldName: "openResponses",
                          arguments: [
                            [
                              "first",
                              { kind: "Literal", value: 1 },
                            ],
                          ],
                          concreteType: "WorkspaceConversationRunOpenResponsesConnection",
                          selections: [
                            {
                              kind: "Linked",
                              fieldName: "edges",
                              arguments: null,
                              concreteType: "WorkspaceConversationRunOpenResponsesConnectionEdge",
                              selections: [
                                {
                                  kind: "Linked",
                                  fieldName: "node",
                                  arguments: null,
                                  concreteType: "OpenResponse",
                                  selections: [
                                    {
                                      kind: "Scalar",
                                      fieldName: "id",
                                      arguments: null,
                                    },
                                    {
                                      kind: "Linked",
                                      fieldName: "outputItems",
                                      arguments: [
                                        [
                                          "first",
                                          { kind: "Literal", value: 200 },
                                        ],
                                      ],
                                      concreteType: "OpenResponseOutputItemsConnection",
                                      selections: [
                                        {
                                          kind: "Linked",
                                          fieldName: "edges",
                                          arguments: null,
                                          concreteType: "OpenResponseOutputItemsConnectionEdge",
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
                                                  kind: "InlineFragment",
                                                  type: "OutputMessage",
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
                                                      kind: "Scalar",
                                                      fieldName: "role",
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
                                    {
                                      kind: "Scalar",
                                      fieldName: "status",
                                      arguments: null,
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
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
  ],
};
export default normalizationAst;
