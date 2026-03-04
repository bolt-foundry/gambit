import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Mutation__GambitWorkspaceGradeFlagToggle__param } from './param_type.ts';
import { Mutation__GambitWorkspaceGradeFlagToggle__output_type } from './output_type.ts';
import { GambitWorkspaceGradeFlagToggleMutation as resolver } from '../../../../mutations/GambitWorkspaceGradeFlagToggle.tsx';

const readerAst: ReaderAst<Mutation__GambitWorkspaceGradeFlagToggle__param> = [
  {
    kind: "Linked",
    fieldName: "workspaceGradeFlagToggle",
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
          {
            kind: "Linked",
            fieldName: "gradeTab",
            alias: null,
            arguments: null,
            condition: null,
            isUpdatable: false,
            refetchQueryIndex: null,
            selections: [
              {
                kind: "Linked",
                fieldName: "flags",
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
                    fieldName: "refId",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "runId",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "turnIndex",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "reason",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "createdAt",
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
        fieldName: "flags",
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
            fieldName: "refId",
            alias: null,
            arguments: null,
            isUpdatable: false,
          },
          {
            kind: "Scalar",
            fieldName: "runId",
            alias: null,
            arguments: null,
            isUpdatable: false,
          },
          {
            kind: "Scalar",
            fieldName: "turnIndex",
            alias: null,
            arguments: null,
            isUpdatable: false,
          },
          {
            kind: "Scalar",
            fieldName: "reason",
            alias: null,
            arguments: null,
            isUpdatable: false,
          },
          {
            kind: "Scalar",
            fieldName: "createdAt",
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
  Mutation__GambitWorkspaceGradeFlagToggle__param,
  Mutation__GambitWorkspaceGradeFlagToggle__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "GambitWorkspaceGradeFlagToggle",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
