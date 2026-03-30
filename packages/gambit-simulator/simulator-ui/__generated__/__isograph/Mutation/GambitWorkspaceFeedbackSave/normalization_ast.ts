import type {NormalizationAst} from '@isograph/react';
const normalizationAst: NormalizationAst = {
  kind: "NormalizationAst",
  selections: [
    {
      kind: "Linked",
      fieldName: "workspaceFeedbackSave",
      arguments: [
        [
          "input",
          { kind: "Variable", name: "input" },
        ],
      ],
      concreteType: "WorkspaceFeedbackSavePayload",
      selections: [
        {
          kind: "Scalar",
          fieldName: "deleted",
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
          ],
        },
      ],
    },
  ],
};
export default normalizationAst;
