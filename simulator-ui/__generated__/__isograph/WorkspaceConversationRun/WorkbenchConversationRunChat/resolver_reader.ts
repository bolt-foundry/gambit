import type {ComponentReaderArtifact, ExtractSecondParam, ReaderAst } from '@isograph/react';
import { WorkspaceConversationRun__WorkbenchConversationRunChat__param } from './param_type.ts';
import { WorkbenchConversationRunChat as resolver } from '../../../../isograph/components/WorkspaceConversationRun/WorkbenchConversationRunChat.tsx';
import OpenResponseOutputItem__asOutputMessage__resolver_reader from '../../OpenResponseOutputItem/asOutputMessage/resolver_reader.ts';
import OpenResponseOutputItem__asOutputReasoning__resolver_reader from '../../OpenResponseOutputItem/asOutputReasoning/resolver_reader.ts';
import OpenResponseOutputItem__asOutputToolCall__resolver_reader from '../../OpenResponseOutputItem/asOutputToolCall/resolver_reader.ts';

const readerAst: ReaderAst<WorkspaceConversationRun__WorkbenchConversationRunChat__param> = [
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
];

const artifact: ComponentReaderArtifact<
  WorkspaceConversationRun__WorkbenchConversationRunChat__param,
  ExtractSecondParam<typeof resolver>
> = {
  kind: "ComponentReaderArtifact",
  fieldName: "WorkbenchConversationRunChat",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
