import type {NormalizationAst} from '@isograph/react';
const normalizationAst: NormalizationAst = {
  kind: "NormalizationAst",
  selections: [
    {
      kind: "Linked",
      fieldName: "gambitWorkspaces",
      arguments: [
        [
          "first",
          { kind: "Literal", value: 200 },
        ],
      ],
      concreteType: "QueryGambitWorkspacesConnection",
      selections: [
        {
          kind: "Linked",
          fieldName: "edges",
          arguments: null,
          concreteType: "QueryGambitWorkspacesConnectionEdge",
          selections: [
            {
              kind: "Linked",
              fieldName: "node",
              arguments: null,
              concreteType: "WorkspaceSessionMeta",
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
                  fieldName: "deck",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "deckSlug",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "sessionDir",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "sqlitePath",
                  arguments: null,
                },
                {
                  kind: "Scalar",
                  fieldName: "testBotName",
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
