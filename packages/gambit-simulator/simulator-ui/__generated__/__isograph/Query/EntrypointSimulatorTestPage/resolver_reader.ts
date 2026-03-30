import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointSimulatorTestPage__param } from './param_type.ts';
import { Query__EntrypointSimulatorTestPage__output_type } from './output_type.ts';
import { EntrypointSimulatorTestPage as resolver } from '../../../../isograph/entrypoints/EntrypointSimulatorTestPage.tsx';
import Workspace__TestTab__resolver_reader from '../../Workspace/TestTab/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointSimulatorTestPage__param> = [
  {
    kind: "Linked",
    fieldName: "workspace",
    alias: null,
    arguments: [
      [
        "id",
        { kind: "Variable", name: "workspaceId" },
      ],
    ],
    condition: null,
    isUpdatable: false,
    refetchQueryIndex: null,
    selections: [
      {
        kind: "Resolver",
        alias: "TestTab",
        arguments: null,
        readerArtifact: Workspace__TestTab__resolver_reader,
        usedRefetchQueries: [],
      },
    ],
  },
];

const artifact: EagerReaderArtifact<
  Query__EntrypointSimulatorTestPage__param,
  Query__EntrypointSimulatorTestPage__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointSimulatorTestPage",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
