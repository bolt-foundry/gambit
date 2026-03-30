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
          fieldName: "files",
          arguments: [
            [
              "first",
              { kind: "Literal", value: 200 },
            ],
          ],
          concreteType: "WorkspaceFilesConnection",
          selections: [
            {
              kind: "Linked",
              fieldName: "edges",
              arguments: null,
              concreteType: "WorkspaceFilesConnectionEdge",
              selections: [
                {
                  kind: "Linked",
                  fieldName: "node",
                  arguments: null,
                  concreteType: "WorkspaceFile",
                  selections: [
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
                      fieldName: "modifiedAt",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "path",
                      arguments: null,
                    },
                    {
                      kind: "Scalar",
                      fieldName: "size",
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
