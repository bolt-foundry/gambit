import type {NormalizationAst} from '@isograph/react';
const normalizationAst: NormalizationAst = {
  kind: "NormalizationAst",
  selections: [
    {
      kind: "Linked",
      fieldName: "gambitWorkspaceDelete",
      arguments: [
        [
          "workspaceId",
          { kind: "Variable", name: "workspaceId" },
        ],
      ],
      concreteType: "WorkspaceDeletePayload",
      selections: [
        {
          kind: "Scalar",
          fieldName: "deleted",
          arguments: null,
        },
        {
          kind: "Scalar",
          fieldName: "error",
          arguments: null,
        },
      ],
    },
  ],
};
export default normalizationAst;
