import type {NormalizationAst} from '@isograph/react';
const normalizationAst: NormalizationAst = {
  kind: "NormalizationAst",
  selections: [
    {
      kind: "Linked",
      fieldName: "workspaceVerifyBatchRunCreate",
      arguments: [
        [
          "input",
          { kind: "Variable", name: "input" },
        ],
      ],
      concreteType: "WorkspaceVerifyBatchRunCreatePayload",
      selections: [
        {
          kind: "Linked",
          fieldName: "batch",
          arguments: null,
          concreteType: "WorkspaceVerifyBatch",
          selections: [
            {
              kind: "Scalar",
              fieldName: "id",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "active",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "completed",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "failed",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "finishedAt",
              arguments: null,
            },
            {
              kind: "Scalar",
              fieldName: "graderId",
              arguments: null,
            },
            {
              kind: "Linked",
              fieldName: "metrics",
              arguments: null,
              concreteType: "WorkspaceVerifyMetrics",
              selections: [
                {
                  kind: "Scalar",
                  fieldName: "agreementRate",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "instabilityCount",
                  arguments: null,
                },
                {
                  kind: "Linked",
                  fieldName: "outliers",
                  arguments: [
                    [
                      "first",
                      { kind: "Literal", value: 25 },
                    ],
                  ],
                  concreteType: "WorkspaceVerifyMetricsOutliersConnection",
                  selections: [
                    {
                      kind: "Linked",
                      fieldName: "edges",
                      arguments: null,
                      concreteType: "WorkspaceVerifyMetricsOutliersConnectionEdge",
                      selections: [
                        {
                          kind: "Linked",
                          fieldName: "node",
                          arguments: null,
                          concreteType: "WorkspaceVerifyOutlier",
                          selections: [
                            {
                              kind: "Scalar",
                              fieldName: "agreementRate",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "instability",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "key",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "label",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "maxRunId",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "messageRefId",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "minRunId",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "passFlip",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "sampleSize",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "scoreDelta",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "turnIndex",
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
                  fieldName: "sampleSize",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "scoreSpreadMax",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "scoreSpreadMedian",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "scoreSpreadMin",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "verdict",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "verdictReason",
                  arguments: null,
                },
              ],
            },
            {
              kind: "Scalar",
              fieldName: "requested",
              arguments: null,
            },
            {
              kind: "Linked",
              fieldName: "requests",
              arguments: [
                [
                  "first",
                  { kind: "Literal", value: 50 },
                ],
              ],
              concreteType: "WorkspaceVerifyBatchRequestsConnection",
              selections: [
                {
                  kind: "Linked",
                  fieldName: "edges",
                  arguments: null,
                  concreteType: "WorkspaceVerifyBatchRequestsConnectionEdge",
                  selections: [
                    {
                      kind: "Linked",
                      fieldName: "node",
                      arguments: null,
                      concreteType: "WorkspaceVerifyBatchRequest",
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
                          fieldName: "runId",
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
            {
              kind: "Scalar",
              fieldName: "scenarioRunId",
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
                  { kind: "Literal", value: 50 },
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
                      ],
                    },
                  ],
                },
              ],
            },
            {
              kind: "Linked",
              fieldName: "verification",
              arguments: null,
              concreteType: "WorkspaceVerification",
              selections: [
                {
                  kind: "Linked",
                  fieldName: "batches",
                  arguments: [
                    [
                      "first",
                      { kind: "Literal", value: 50 },
                    ],
                  ],
                  concreteType: "WorkspaceVerificationBatchesConnection",
                  selections: [
                    {
                      kind: "Linked",
                      fieldName: "edges",
                      arguments: null,
                      concreteType: "WorkspaceVerificationBatchesConnectionEdge",
                      selections: [
                        {
                          kind: "Linked",
                          fieldName: "node",
                          arguments: null,
                          concreteType: "WorkspaceVerifyBatch",
                          selections: [
                            {
                              kind: "Scalar",
                              fieldName: "id",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "active",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "completed",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "failed",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "finishedAt",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "graderId",
                              arguments: null,
                            },
                            {
                              kind: "Linked",
                              fieldName: "metrics",
                              arguments: null,
                              concreteType: "WorkspaceVerifyMetrics",
                              selections: [
                                {
                                  kind: "Scalar",
                                  fieldName: "agreementRate",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "instabilityCount",
                                  arguments: null,
                                },
                                {
                                  kind: "Linked",
                                  fieldName: "outliers",
                                  arguments: [
                                    [
                                      "first",
                                      { kind: "Literal", value: 25 },
                                    ],
                                  ],
                                  concreteType: "WorkspaceVerifyMetricsOutliersConnection",
                                  selections: [
                                    {
                                      kind: "Linked",
                                      fieldName: "edges",
                                      arguments: null,
                                      concreteType: "WorkspaceVerifyMetricsOutliersConnectionEdge",
                                      selections: [
                                        {
                                          kind: "Linked",
                                          fieldName: "node",
                                          arguments: null,
                                          concreteType: "WorkspaceVerifyOutlier",
                                          selections: [
                                            {
                                              kind: "Scalar",
                                              fieldName: "agreementRate",
                                              arguments: null,
                                            },
                                            {
                                              kind: "Scalar",
                                              fieldName: "instability",
                                              arguments: null,
                                            },
                                            {
                                              kind: "Scalar",
                                              fieldName: "key",
                                              arguments: null,
                                            },
                                            {
                                              kind: "Scalar",
                                              fieldName: "label",
                                              arguments: null,
                                            },
                                            {
                                              kind: "Scalar",
                                              fieldName: "maxRunId",
                                              arguments: null,
                                            },
                                            {
                                              kind: "Scalar",
                                              fieldName: "messageRefId",
                                              arguments: null,
                                            },
                                            {
                                              kind: "Scalar",
                                              fieldName: "minRunId",
                                              arguments: null,
                                            },
                                            {
                                              kind: "Scalar",
                                              fieldName: "passFlip",
                                              arguments: null,
                                            },
                                            {
                                              kind: "Scalar",
                                              fieldName: "sampleSize",
                                              arguments: null,
                                            },
                                            {
                                              kind: "Scalar",
                                              fieldName: "scoreDelta",
                                              arguments: null,
                                            },
                                            {
                                              kind: "Scalar",
                                              fieldName: "turnIndex",
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
                                  fieldName: "sampleSize",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "scoreSpreadMax",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "scoreSpreadMedian",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "scoreSpreadMin",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "verdict",
                                  arguments: null,
                                },
                                {
                                  kind: "Scalar",
                                  fieldName: "verdictReason",
                                  arguments: null,
                                },
                              ],
                            },
                            {
                              kind: "Scalar",
                              fieldName: "requested",
                              arguments: null,
                            },
                            {
                              kind: "Linked",
                              fieldName: "requests",
                              arguments: [
                                [
                                  "first",
                                  { kind: "Literal", value: 50 },
                                ],
                              ],
                              concreteType: "WorkspaceVerifyBatchRequestsConnection",
                              selections: [
                                {
                                  kind: "Linked",
                                  fieldName: "edges",
                                  arguments: null,
                                  concreteType: "WorkspaceVerifyBatchRequestsConnectionEdge",
                                  selections: [
                                    {
                                      kind: "Linked",
                                      fieldName: "node",
                                      arguments: null,
                                      concreteType: "WorkspaceVerifyBatchRequest",
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
                                          fieldName: "runId",
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
                            {
                              kind: "Scalar",
                              fieldName: "scenarioRunId",
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
                  fieldName: "graderDecks",
                  arguments: [
                    [
                      "first",
                      { kind: "Literal", value: 50 },
                    ],
                  ],
                  concreteType: "WorkspaceVerificationGraderDecksConnection",
                  selections: [
                    {
                      kind: "Linked",
                      fieldName: "edges",
                      arguments: null,
                      concreteType: "WorkspaceVerificationGraderDecksConnectionEdge",
                      selections: [
                        {
                          kind: "Linked",
                          fieldName: "node",
                          arguments: null,
                          concreteType: "WorkspaceGraderDeck",
                          selections: [
                            {
                              kind: "Scalar",
                              fieldName: "id",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "description",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "label",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "path",
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
};
export default normalizationAst;
