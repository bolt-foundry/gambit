import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Query__EntrypointWorkspaceWorkbenchLiveWrite__param } from './param_type.ts';
import { Query__EntrypointWorkspaceWorkbenchLiveWrite__output_type } from './output_type.ts';
import { EntrypointWorkspaceWorkbenchLiveWrite as resolver } from '../../../../isograph/entrypoints/EntrypointWorkspaceWorkbenchLiveWrite.tsx';
import WorkspaceConversationRun__WorkbenchConversationRunChat__resolver_reader from '../../WorkspaceConversationRun/WorkbenchConversationRunChat/resolver_reader.ts';

const readerAst: ReaderAst<Query__EntrypointWorkspaceWorkbenchLiveWrite__param> = [
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
        fieldName: "models",
        alias: null,
        arguments: null,
        condition: null,
        isUpdatable: false,
        refetchQueryIndex: null,
        selections: [
          {
            kind: "Linked",
            fieldName: "codex",
            alias: null,
            arguments: null,
            condition: null,
            isUpdatable: false,
            refetchQueryIndex: null,
            selections: [
              {
                kind: "Scalar",
                fieldName: "model",
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
                fieldName: "available",
                alias: null,
                arguments: null,
                isUpdatable: false,
              },
              {
                kind: "Scalar",
                fieldName: "requiresLogin",
                alias: null,
                arguments: null,
                isUpdatable: false,
              },
              {
                kind: "Scalar",
                fieldName: "loggedIn",
                alias: null,
                arguments: null,
                isUpdatable: false,
              },
              {
                kind: "Scalar",
                fieldName: "statusText",
                alias: null,
                arguments: null,
                isUpdatable: false,
              },
              {
                kind: "Scalar",
                fieldName: "trustedPath",
                alias: null,
                arguments: null,
                isUpdatable: false,
              },
              {
                kind: "Scalar",
                fieldName: "writeEnabled",
                alias: null,
                arguments: null,
                isUpdatable: false,
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
                    kind: "Resolver",
                    alias: "WorkbenchConversationRunChat",
                    arguments: null,
                    readerArtifact: WorkspaceConversationRun__WorkbenchConversationRunChat__resolver_reader,
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
  Query__EntrypointWorkspaceWorkbenchLiveWrite__param,
  Query__EntrypointWorkspaceWorkbenchLiveWrite__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "EntrypointWorkspaceWorkbenchLiveWrite",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
