import type {ComponentReaderArtifact, ExtractSecondParam, ReaderAst } from '@isograph/react';
import { Workspace__BuildTab__param } from './param_type.ts';
import { SimulatorBuildPage as resolver } from '../../../../isograph/components/Query/SimulatorBuildPage.tsx';
import WorkspaceFile__PreviewFile__resolver_reader from '../../WorkspaceFile/PreviewFile/resolver_reader.ts';

const readerAst: ReaderAst<Workspace__BuildTab__param> = [
  {
    kind: "Linked",
    fieldName: "files",
    alias: null,
    arguments: [
      [
        "first",
        { kind: "Literal", value: 200 },
      ],
    ],
    condition: null,
    isUpdatable: false,
    refetchQueryIndex: null,
    selections: [
      {
        kind: "Linked",
        fieldName: "edges",
        alias: null,
        arguments: null,
        condition: null,
        isUpdatable: false,
        refetchQueryIndex: null,
        selections: [
          {
            kind: "Linked",
            fieldName: "node",
            alias: null,
            arguments: null,
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
              {
                kind: "Scalar",
                fieldName: "path",
                alias: null,
                arguments: null,
                isUpdatable: false,
              },
              {
                kind: "Resolver",
                alias: "PreviewFile",
                arguments: null,
                readerArtifact: WorkspaceFile__PreviewFile__resolver_reader,
                usedRefetchQueries: [],
              },
            ],
          },
        ],
      },
    ],
  },
];

const artifact: ComponentReaderArtifact<
  Workspace__BuildTab__param,
  ExtractSecondParam<typeof resolver>
> = {
  kind: "ComponentReaderArtifact",
  fieldName: "BuildTab",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
