import type {NormalizationAst} from '@isograph/react';
const normalizationAst: NormalizationAst = {
  kind: "NormalizationAst",
  selections: [
    {
      kind: "Linked",
      fieldName: "workspaceGradeFlagToggle",
      arguments: [
        [
          "input",
          { kind: "Variable", name: "input" },
        ],
      ],
      concreteType: "WorkspaceGradeFlagTogglePayload",
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
              ],
            },
          ],
        },
      ],
    },
  ],
};
export default normalizationAst;
