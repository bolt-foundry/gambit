import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointWorkspaceBuildTabLiveWrite__param } from './param_type.ts';
import { Query__EntrypointWorkspaceBuildTabLiveWrite__output_type } from './output_type.ts';
import { EntrypointWorkspaceBuildTabLiveWrite as resolver } from '../../../../isograph/entrypoints/EntrypointWorkspaceBuildTabLiveWrite.tsx';
import WorkspaceFile__PreviewFile__resolver_reader from '../../WorkspaceFile/PreviewFile/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointWorkspaceBuildTabLiveWrite__param> = [
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
    ],
  },
];

const artifact: EagerReaderArtifact<
  Query__EntrypointWorkspaceBuildTabLiveWrite__param,
  Query__EntrypointWorkspaceBuildTabLiveWrite__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointWorkspaceBuildTabLiveWrite",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
