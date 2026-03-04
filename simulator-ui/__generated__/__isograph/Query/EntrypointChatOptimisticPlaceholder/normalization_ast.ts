import type {NormalizationAst} from '@isograph/react';
const normalizationAst: NormalizationAst = {
  kind: "NormalizationAst",
  selections: [
    {
      kind: "Scalar",
      fieldName: "__typename",
      arguments: null,
    },
    {
      kind: "Linked",
      fieldName: "workspace",
      arguments: [
        [
          "id",
          { kind: "Variable", name: "optimisticMessage" },
        ],
      ],
      concreteType: "Workspace",
      selections: [
        {
          kind: "Scalar",
          fieldName: "id",
          arguments: null,
        },
      ],
    },
  ],
};
export default normalizationAst;
