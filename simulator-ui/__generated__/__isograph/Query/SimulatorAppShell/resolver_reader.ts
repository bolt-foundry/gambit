import type {ComponentReaderArtifact, ExtractSecondParam, ReaderAst } from '@isograph/react';
import { Query__SimulatorAppShell__param } from './param_type.ts';
import { SimulatorAppShell as resolver } from '../../../../isograph/components/Query/SimulatorAppShell.tsx';
import Query__SimulatorAppDrawer__resolver_reader from '../../Query/SimulatorAppDrawer/resolver_reader.ts';

const readerAst: ReaderAst<Query__SimulatorAppShell__param> = [
  {
    kind: "Resolver",
    alias: "SimulatorAppDrawer",
    arguments: null,
    readerArtifact: Query__SimulatorAppDrawer__resolver_reader,
    usedRefetchQueries: [],
  },
];

const artifact: ComponentReaderArtifact<
  Query__SimulatorAppShell__param,
  ExtractSecondParam<typeof resolver>
> = {
  kind: "ComponentReaderArtifact",
  fieldName: "SimulatorAppShell",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
