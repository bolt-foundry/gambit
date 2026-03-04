import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointSimulatorBuildPage__param } from './param_type.ts';
import { Query__EntrypointSimulatorBuildPage__output_type } from './output_type.ts';
import { EntrypointSimulatorBuildPage as resolver } from '../../../../isograph/entrypoints/EntrypointSimulatorBuildPage.tsx';
import Workspace__BuildTab__resolver_reader from '../../Workspace/BuildTab/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointSimulatorBuildPage__param> = [
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
        alias: "BuildTab",
        arguments: null,
        readerArtifact: Workspace__BuildTab__resolver_reader,
        usedRefetchQueries: [],
      },
    ],
  },
];

const artifact: EagerReaderArtifact<
  Query__EntrypointSimulatorBuildPage__param,
  Query__EntrypointSimulatorBuildPage__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointSimulatorBuildPage",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
