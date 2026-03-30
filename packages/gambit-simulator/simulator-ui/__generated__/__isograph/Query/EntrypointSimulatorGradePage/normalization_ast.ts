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
          fieldName: "gradeTab",
          arguments: null,
          concreteType: "WorkspaceGradeTab",
          selections: [
            {
              kind: "Linked",
              fieldName: "flags",
              arguments: null,
              concreteType: "WorkspaceGradeFlag",
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
                  fieldName: "reason",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "refId",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "runId",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "turnIndex",
                  arguments: null,
                },
              ],
            },
            {
              kind: "Linked",
              fieldName: "graderDecks",
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
            {
              kind: "Linked",
              fieldName: "runs",
              arguments: null,
              concreteType: "WorkspaceGradeRun",
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
                  fieldName: "graderId",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "graderLabel",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "graderPath",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "runAt",
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
                {
                  kind: "Linked",
                  fieldName: "summary",
                  arguments: null,
                  concreteType: "WorkspaceGradeRunSummary",
                  selections: [
                    {
                      kind: "Scalar",
                      fieldName: "reason",
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
                  fieldName: "turns",
                  arguments: null,
                  concreteType: "WorkspaceGradeTurn",
                  selections: [
                    {
                      kind: "Scalar",
                      fieldName: "id",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "gradedAssistant",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "priorUser",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "reason",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "refId",
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
                    {
                      kind: "Scalar",
                      fieldName: "turnIndex",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "turnNumber",
                      arguments: null,
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
          ],
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
          kind: "Scalar",
          fieldName: "workbenchSelectedContextChips",
          arguments: null,
        },
      ],
    },
  ],
};
export default normalizationAst;
