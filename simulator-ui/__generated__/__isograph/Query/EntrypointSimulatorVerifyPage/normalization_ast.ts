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
                          kind: "Scalar",
                          fieldName: "graderRepeatsPerScenario",
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
                              fieldName: "executionFailureCount",
                              arguments: null,
                            },
                            {
                              kind: "Linked",
                              fieldName: "failureReasons",
                              arguments: [
                                [
                                  "first",
                                  { kind: "Literal", value: 25 },
                                ],
                              ],
                              concreteType: "WorkspaceVerifyMetricsFailureReasonsConnection",
                              selections: [
                                {
                                  kind: "Linked",
                                  fieldName: "edges",
                                  arguments: null,
                                  concreteType: "WorkspaceVerifyMetricsFailureReasonsConnectionEdge",
                                  selections: [
                                    {
                                      kind: "Linked",
                                      fieldName: "node",
                                      arguments: null,
                                      concreteType: "WorkspaceVerifyFailureReasonGroup",
                                      selections: [
                                        {
                                          kind: "Scalar",
                                          fieldName: "count",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "key",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "kind",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "reason",
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
                              fieldName: "gradeSampleCountCompleted",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "gradeSampleCountFailed",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "gradeSampleCountRequested",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "gradingFailureCount",
                              arguments: null,
                            },
                            {
                              kind: "Linked",
                              fieldName: "outlierScenarioRuns",
                              arguments: [
                                [
                                  "first",
                                  { kind: "Literal", value: 25 },
                                ],
                              ],
                              concreteType: "WorkspaceVerifyMetricsOutlierScenarioRunsConnection",
                              selections: [
                                {
                                  kind: "Linked",
                                  fieldName: "edges",
                                  arguments: null,
                                  concreteType: "WorkspaceVerifyMetricsOutlierScenarioRunsConnectionEdge",
                                  selections: [
                                    {
                                      kind: "Linked",
                                      fieldName: "node",
                                      arguments: null,
                                      concreteType: "WorkspaceVerifyScenarioOutlier",
                                      selections: [
                                        {
                                          kind: "Scalar",
                                          fieldName: "averageScore",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "completedSampleCount",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "executionFailureCount",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "failed",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "gradeSampleCount",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "gradingFailureCount",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "key",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "maxRunId",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "maxScore",
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
                                          fieldName: "minScore",
                                          arguments: null,
                                        },
                                        {
                                          kind: "Scalar",
                                          fieldName: "scenarioRunId",
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
                              fieldName: "passRate",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "scenarioRunCountCompleted",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "scenarioRunCountFailed",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "scenarioRunCountRequested",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "scoreMax",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "scoreMean",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "scoreMedian",
                              arguments: null,
                            },
                            {
                              kind: "Scalar",
                              fieldName: "scoreMin",
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
                              { kind: "Literal", value: 200 },
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
                                      fieldName: "scenarioRunId",
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
                          fieldName: "scenarioDeckId",
                          arguments: null,
                        },
                        {
                          kind: "Scalar",
                          fieldName: "scenarioRuns",
                          arguments: null,
                        },
                        {
                          kind: "Scalar",
                          fieldName: "scenarioRunsCompleted",
                          arguments: null,
                        },
                        {
                          kind: "Scalar",
                          fieldName: "scenarioRunsFailed",
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
