import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointWorkspaceBuildLiveWrite__param } from './param_type.ts';
import { Query__EntrypointWorkspaceBuildLiveWrite__output_type } from './output_type.ts';
import { EntrypointWorkspaceBuildLiveWrite as resolver } from '../../../../isograph/entrypoints/EntrypointWorkspaceBuildLiveWrite.tsx';
import OpenResponseOutputItem__asOutputMessage__resolver_reader from '../../OpenResponseOutputItem/asOutputMessage/resolver_reader.ts';
import OpenResponseOutputItem__asOutputReasoning__resolver_reader from '../../OpenResponseOutputItem/asOutputReasoning/resolver_reader.ts';
import OpenResponseOutputItem__asOutputToolCall__resolver_reader from '../../OpenResponseOutputItem/asOutputToolCall/resolver_reader.ts';
import WorkspaceFile__PreviewFile__resolver_reader from '../../WorkspaceFile/PreviewFile/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointWorkspaceBuildLiveWrite__param> = [
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
        fieldName: "scenarioDecks",
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
            fieldName: "label",
            alias: null,
            arguments: null,
            isUpdatable: false,
          },
          {
            kind: "Scalar",
            fieldName: "description",
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
            kind: "Scalar",
            fieldName: "maxTurns",
            alias: null,
            arguments: null,
            isUpdatable: false,
          },
        ],
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
      {
        kind: "Linked",
        fieldName: "buildRuns",
        alias: null,
        arguments: [
          [
            "first",
            { kind: "Literal", value: 1 },
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
                    fieldName: "workspaceId",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "status",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "error",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "startedAt",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Linked",
                    fieldName: "openResponses",
                    alias: null,
                    arguments: [
                      [
                        "first",
                        { kind: "Literal", value: 1 },
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
                                fieldName: "status",
                                alias: null,
                                arguments: null,
                                isUpdatable: false,
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: "Linked",
        fieldName: "scenarioRuns",
        alias: null,
        arguments: [
          [
            "first",
            { kind: "Literal", value: 25 },
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
                    fieldName: "status",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "startedAt",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "finishedAt",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "error",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Linked",
                    fieldName: "openResponses",
                    alias: null,
                    arguments: [
                      [
                        "first",
                        { kind: "Literal", value: 1 },
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
                                fieldName: "status",
                                alias: null,
                                arguments: null,
                                isUpdatable: false,
                              },
                              {
                                kind: "Linked",
                                fieldName: "outputItems",
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
                                            fieldName: "__typename",
                                            alias: null,
                                            arguments: null,
                                            isUpdatable: false,
                                          },
                                          {
                                            kind: "Linked",
                                            fieldName: "asOutputMessage",
                                            alias: null,
                                            arguments: null,
                                            condition: OpenResponseOutputItem__asOutputMessage__resolver_reader,
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
                                                fieldName: "role",
                                                alias: null,
                                                arguments: null,
                                                isUpdatable: false,
                                              },
                                              {
                                                kind: "Scalar",
                                                fieldName: "content",
                                                alias: null,
                                                arguments: null,
                                                isUpdatable: false,
                                              },
                                            ],
                                          },
                                          {
                                            kind: "Linked",
                                            fieldName: "asOutputReasoning",
                                            alias: null,
                                            arguments: null,
                                            condition: OpenResponseOutputItem__asOutputReasoning__resolver_reader,
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
                                                fieldName: "summary",
                                                alias: null,
                                                arguments: null,
                                                isUpdatable: false,
                                              },
                                              {
                                                kind: "Scalar",
                                                fieldName: "reasoningType",
                                                alias: null,
                                                arguments: null,
                                                isUpdatable: false,
                                              },
                                            ],
                                          },
                                          {
                                            kind: "Linked",
                                            fieldName: "asOutputToolCall",
                                            alias: null,
                                            arguments: null,
                                            condition: OpenResponseOutputItem__asOutputToolCall__resolver_reader,
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
                                                fieldName: "toolCallId",
                                                alias: null,
                                                arguments: null,
                                                isUpdatable: false,
                                              },
                                              {
                                                kind: "Scalar",
                                                fieldName: "toolName",
                                                alias: null,
                                                arguments: null,
                                                isUpdatable: false,
                                              },
                                              {
                                                kind: "Scalar",
                                                fieldName: "status",
                                                alias: null,
                                                arguments: null,
                                                isUpdatable: false,
                                              },
                                              {
                                                kind: "Scalar",
                                                fieldName: "argumentsText",
                                                alias: null,
                                                arguments: null,
                                                isUpdatable: false,
                                              },
                                              {
                                                kind: "Scalar",
                                                fieldName: "resultText",
                                                alias: null,
                                                arguments: null,
                                                isUpdatable: false,
                                              },
                                              {
                                                kind: "Scalar",
                                                fieldName: "error",
                                                alias: null,
                                                arguments: null,
                                                isUpdatable: false,
                                              },
                                            ],
                                          },
                                        ],
                                      },
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
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
  Query__EntrypointWorkspaceBuildLiveWrite__param,
  Query__EntrypointWorkspaceBuildLiveWrite__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointWorkspaceBuildLiveWrite",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
