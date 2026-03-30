import type {ComponentReaderArtifact, ExtractSecondParam, ReaderAst } from '@isograph/react';
import { Query__SimulatorRootPage__param } from './param_type.ts';
import { SimulatorRootPage as resolver } from '../../../../isograph/components/Query/SimulatorRootPage.tsx';

const readerAst: ReaderAst<Query__SimulatorRootPage__param> = [
  {
    kind: "Scalar",
    fieldName: "__typename",
    alias: null,
    arguments: null,
    isUpdatable: false,
  },
];

const artifact: ComponentReaderArtifact<
  Query__SimulatorRootPage__param,
  ExtractSecondParam<typeof resolver>
> = {
  kind: "ComponentReaderArtifact",
  fieldName: "SimulatorRootPage",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
