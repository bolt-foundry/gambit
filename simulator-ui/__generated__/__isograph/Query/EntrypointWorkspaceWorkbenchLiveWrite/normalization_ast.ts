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
          fieldName: "buildRuns",
          arguments: [
            [
              "first",
              { kind: "Literal", value: 1 },
            ],
          ],
          concreteType: "WorkspaceBuildRunsConnection",
          selections: [
            {
              kind: "Linked",
              fieldName: "edges",
              arguments: null,
              concreteType: "WorkspaceBuildRunsConnectionEdge",
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
              ],
            },
          ],
        },
        {
          kind: "Linked",
          fieldName: "models",
          arguments: null,
          concreteType: "WorkspaceModels",
          selections: [
            {
              kind: "Linked",
              fieldName: "codex",
              arguments: null,
              concreteType: "WorkspaceModelStatus",
              selections: [
                {
                  kind: "Scalar",
                  fieldName: "available",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "loggedIn",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "model",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "requiresLogin",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "statusText",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "trustedPath",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "workspaceId",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "writeEnabled",
                  arguments: null,
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
