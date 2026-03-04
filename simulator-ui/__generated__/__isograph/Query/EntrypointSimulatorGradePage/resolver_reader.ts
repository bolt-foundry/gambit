import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointSimulatorGradePage__param } from './param_type.ts';
import { Query__EntrypointSimulatorGradePage__output_type } from './output_type.ts';
import { EntrypointSimulatorGradePage as resolver } from '../../../../isograph/entrypoints/EntrypointSimulatorGradePage.tsx';
import Workspace__GradeTab__resolver_reader from '../../Workspace/GradeTab/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointSimulatorGradePage__param> = [
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
        alias: "GradeTab",
        arguments: null,
        readerArtifact: Workspace__GradeTab__resolver_reader,
        usedRefetchQueries: [],
      },
    ],
  },
];

const artifact: EagerReaderArtifact<
  Query__EntrypointSimulatorGradePage__param,
  Query__EntrypointSimulatorGradePage__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointSimulatorGradePage",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
