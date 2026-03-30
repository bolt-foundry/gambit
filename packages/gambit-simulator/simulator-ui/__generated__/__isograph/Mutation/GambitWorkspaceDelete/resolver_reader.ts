import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Mutation__GambitWorkspaceDelete__param } from './param_type.ts';
import { Mutation__GambitWorkspaceDelete__output_type } from './output_type.ts';
import { GambitWorkspaceDeleteMutation as resolver } from '../../../../mutations/GambitWorkspaceDelete.tsx';

const readerAst: ReaderAst<Mutation__GambitWorkspaceDelete__param> = [
  {
    kind: "Linked",
    fieldName: "gambitWorkspaceDelete",
    alias: null,
    arguments: [
      [
        "workspaceId",
        { kind: "Variable", name: "workspaceId" },
      ],
    ],
    condition: null,
    isUpdatable: false,
    refetchQueryIndex: null,
    selections: [
      {
        kind: "Scalar",
        fieldName: "deleted",
        alias: null,
        arguments: null,
        isUpdatable: false,
      },
      {
        kind: "Scalar",
        fieldName: "error",
        alias: null,
        arguments: null,
        isUpdatable: false,
      },
    ],
  },
];

const artifact: EagerReaderArtifact<
  Mutation__GambitWorkspaceDelete__param,
  Mutation__GambitWorkspaceDelete__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "GambitWorkspaceDelete",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
