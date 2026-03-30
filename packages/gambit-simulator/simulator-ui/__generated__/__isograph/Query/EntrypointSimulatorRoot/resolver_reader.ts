import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointSimulatorRoot__param } from './param_type.ts';
import { Query__EntrypointSimulatorRoot__output_type } from './output_type.ts';
import { EntrypointSimulatorRoot as resolver } from '../../../../isograph/entrypoints/EntrypointSimulatorRoot.tsx';
import Query__SimulatorRootPage__resolver_reader from '../../Query/SimulatorRootPage/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointSimulatorRoot__param> = [
  {
    kind: "Resolver",
    alias: "SimulatorRootPage",
    arguments: null,
    readerArtifact: Query__SimulatorRootPage__resolver_reader,
    usedRefetchQueries: [],
  },
];

const artifact: EagerReaderArtifact<
  Query__EntrypointSimulatorRoot__param,
  Query__EntrypointSimulatorRoot__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointSimulatorRoot",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
