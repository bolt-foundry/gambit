import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointSimulatorWorkspaces__param } from './param_type.ts';
import { Query__EntrypointSimulatorWorkspaces__output_type } from './output_type.ts';
import { EntrypointSimulatorWorkspaces as resolver } from '../../../../isograph/entrypoints/EntrypointSimulatorWorkspaces.tsx';
import Query__SimulatorAppShell__resolver_reader from '../../Query/SimulatorAppShell/resolver_reader.ts';
import Query__SimulatorWorkspacesPage__resolver_reader from '../../Query/SimulatorWorkspacesPage/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointSimulatorWorkspaces__param> = [
  {
    kind: "Resolver",
    alias: "SimulatorAppShell",
    arguments: null,
    readerArtifact: Query__SimulatorAppShell__resolver_reader,
    usedRefetchQueries: [],
  },
  {
    kind: "Resolver",
    alias: "SimulatorWorkspacesPage",
    arguments: null,
    readerArtifact: Query__SimulatorWorkspacesPage__resolver_reader,
    usedRefetchQueries: [],
  },
];

const artifact: EagerReaderArtifact<
  Query__EntrypointSimulatorWorkspaces__param,
  Query__EntrypointSimulatorWorkspaces__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointSimulatorWorkspaces",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
