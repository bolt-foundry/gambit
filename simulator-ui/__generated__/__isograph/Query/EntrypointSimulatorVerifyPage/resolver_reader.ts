import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointSimulatorVerifyPage__param } from './param_type.ts';
import { Query__EntrypointSimulatorVerifyPage__output_type } from './output_type.ts';
import { EntrypointSimulatorVerifyPage as resolver } from '../../../../isograph/entrypoints/EntrypointSimulatorVerifyPage.tsx';
import Workspace__VerifyTab__resolver_reader from '../../Workspace/VerifyTab/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointSimulatorVerifyPage__param> = [
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
        alias: "VerifyTab",
        arguments: null,
        readerArtifact: Workspace__VerifyTab__resolver_reader,
        usedRefetchQueries: [],
      },
    ],
  },
];

const artifact: EagerReaderArtifact<
  Query__EntrypointSimulatorVerifyPage__param,
  Query__EntrypointSimulatorVerifyPage__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointSimulatorVerifyPage",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
