import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Mutation__GambitWorkspaceConversationSessionStart__param } from './param_type.ts';
import { Mutation__GambitWorkspaceConversationSessionStart__output_type } from './output_type.ts';
import { GambitWorkspaceConversationSessionStartMutation as resolver } from '../../../../mutations/GambitWorkspaceConversationSessionStart.tsx';
import WorkspaceConversationSession__asWorkspaceBuildConversationSession__resolver_reader from '../../WorkspaceConversationSession/asWorkspaceBuildConversationSession/resolver_reader.ts';
import WorkspaceConversationSession__asWorkspaceGraderConversationSession__resolver_reader from '../../WorkspaceConversationSession/asWorkspaceGraderConversationSession/resolver_reader.ts';
import WorkspaceConversationSession__asWorkspaceScenarioConversationSession__resolver_reader from '../../WorkspaceConversationSession/asWorkspaceScenarioConversationSession/resolver_reader.ts';
import WorkspaceConversationSession__asWorkspaceVerifyConversationSession__resolver_reader from '../../WorkspaceConversationSession/asWorkspaceVerifyConversationSession/resolver_reader.ts';

const readerAst: ReaderAst<Mutation__GambitWorkspaceConversationSessionStart__param> = [
  {
    kind: "Linked",
    fieldName: "workspaceConversationSessionStart",
    alias: null,
    arguments: [
      [
        "input",
        { kind: "Variable", name: "input" },
      ],
    ],
    condition: null,
    isUpdatable: false,
    refetchQueryIndex: null,
    selections: [
      {
        kind: "Linked",
        fieldName: "session",
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
            kind: "Scalar",
            fieldName: "sessionId",
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
            fieldName: "asWorkspaceBuildConversationSession",
            alias: null,
            arguments: null,
            condition: WorkspaceConversationSession__asWorkspaceBuildConversationSession__resolver_reader,
            isUpdatable: false,
            refetchQueryIndex: null,
            selections: [
              {
                kind: "Linked",
                fieldName: "run",
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
                ],
              },
            ],
          },
          {
            kind: "Linked",
            fieldName: "asWorkspaceScenarioConversationSession",
            alias: null,
            arguments: null,
            condition: WorkspaceConversationSession__asWorkspaceScenarioConversationSession__resolver_reader,
            isUpdatable: false,
            refetchQueryIndex: null,
            selections: [
              {
                kind: "Linked",
                fieldName: "run",
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
                ],
              },
            ],
          },
          {
            kind: "Linked",
            fieldName: "asWorkspaceGraderConversationSession",
            alias: null,
            arguments: null,
            condition: WorkspaceConversationSession__asWorkspaceGraderConversationSession__resolver_reader,
            isUpdatable: false,
            refetchQueryIndex: null,
            selections: [
              {
                kind: "Linked",
                fieldName: "gradeRun",
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
                ],
              },
            ],
          },
          {
            kind: "Linked",
            fieldName: "asWorkspaceVerifyConversationSession",
            alias: null,
            arguments: null,
            condition: WorkspaceConversationSession__asWorkspaceVerifyConversationSession__resolver_reader,
            isUpdatable: false,
            refetchQueryIndex: null,
            selections: [
              {
                kind: "Linked",
                fieldName: "verifyBatch",
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
                ],
              },
            ],
          },
        ],
      },
      {
        kind: "Linked",
        fieldName: "workspace",
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
        ],
      },
    ],
  },
];

const artifact: EagerReaderArtifact<
  Mutation__GambitWorkspaceConversationSessionStart__param,
  Mutation__GambitWorkspaceConversationSessionStart__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "GambitWorkspaceConversationSessionStart",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
