import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointSimulatorRedirect__param } from './param_type.ts';
import { Query__EntrypointSimulatorRedirect__output_type } from './output_type.ts';
import { EntrypointSimulatorRedirect as resolver } from '../../../../isograph/entrypoints/EntrypointSimulatorRedirect.tsx';
import Query__SimulatorRootPage__resolver_reader from '../../Query/SimulatorRootPage/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointSimulatorRedirect__param> = [
  {
    kind: "Resolver",
    alias: "SimulatorRootPage",
    arguments: null,
    readerArtifact: Query__SimulatorRootPage__resolver_reader,
    usedRefetchQueries: [],
  },
];

const artifact: EagerReaderArtifact<
  Query__EntrypointSimulatorRedirect__param,
  Query__EntrypointSimulatorRedirect__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointSimulatorRedirect",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
