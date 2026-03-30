import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointChatOptimisticPlaceholder__param } from './param_type.ts';
import { Query__EntrypointChatOptimisticPlaceholder__output_type } from './output_type.ts';
import { EntrypointChatOptimisticPlaceholder as resolver } from '../../../../isograph/entrypoints/EntrypointChatOptimisticPlaceholder.tsx';

const readerAst: ReaderAst<Query__EntrypointChatOptimisticPlaceholder__param> = [
  {
    kind: "Scalar",
    fieldName: "__typename",
    alias: "optimisticMessageCarrier",
    arguments: null,
    isUpdatable: false,
  },
  {
    kind: "Linked",
    fieldName: "workspace",
    alias: "optimisticMessageWorkspaceProbe",
    arguments: [
      [
        "id",
        { kind: "Variable", name: "optimisticMessage" },
      ],
    ],
    condition: null,
    isUpdatable: false,
    refetchQueryIndex: null,
    selections: [
      {
        kind: "Scalar",
        fieldName: "id",
        alias: null,
        arguments: null,
        isUpdatable: false,
      },
    ],
  },
];

const artifact: EagerReaderArtifact<
  Query__EntrypointChatOptimisticPlaceholder__param,
  Query__EntrypointChatOptimisticPlaceholder__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointChatOptimisticPlaceholder",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
