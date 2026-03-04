import type {ComponentReaderArtifact, ExtractSecondParam, ReaderAst } from '@isograph/react';
import { Query__SimulatorBuildContentShell__param } from './param_type.ts';
import { SimulatorBuildContentShell as resolver } from '../../../../isograph/components/Query/SimulatorBuildContentShell.tsx';
import Query__SimulatorAppDrawer__resolver_reader from '../../Query/SimulatorAppDrawer/resolver_reader.ts';
import Workspace__WorkbenchChatDrawer__resolver_reader from '../../Workspace/WorkbenchChatDrawer/resolver_reader.ts';

const readerAst: ReaderAst<Query__SimulatorBuildContentShell__param> = [
  {
    kind: "Resolver",
    alias: "SimulatorAppDrawer",
    arguments: null,
    readerArtifact: Query__SimulatorAppDrawer__resolver_reader,
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
        kind: "Resolver",
        alias: "WorkbenchChatDrawer",
        arguments: null,
        readerArtifact: Workspace__WorkbenchChatDrawer__resolver_reader,
        usedRefetchQueries: [],
      },
    ],
  },
];

const artifact: ComponentReaderArtifact<
  Query__SimulatorBuildContentShell__param,
  ExtractSecondParam<typeof resolver>
> = {
  kind: "ComponentReaderArtifact",
  fieldName: "SimulatorBuildContentShell",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
