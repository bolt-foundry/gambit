import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointSimulatorWorkspaceShell__param } from './param_type.ts';
import { Query__EntrypointSimulatorWorkspaceShell__output_type } from './output_type.ts';
import { EntrypointSimulatorWorkspaceShell as resolver } from '../../../../isograph/entrypoints/EntrypointSimulatorWorkspaceShell.tsx';
import Query__SimulatorBuildContentShell__resolver_reader from '../../Query/SimulatorBuildContentShell/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointSimulatorWorkspaceShell__param> = [
  {
    kind: "Resolver",
    alias: "SimulatorBuildContentShell",
    arguments: [
      [
        "workspaceId",
        { kind: "Variable", name: "workspaceId" },
      ],
    ],
    readerArtifact: Query__SimulatorBuildContentShell__resolver_reader,
    usedRefetchQueries: [],
  },
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
  Query__EntrypointSimulatorWorkspaceShell__param,
  Query__EntrypointSimulatorWorkspaceShell__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointSimulatorWorkspaceShell",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
