import type { EagerReaderArtifact, ReaderAst } from '@isograph/react';
import { Mutation__GambitWorkspaceCreate__param } from './param_type.ts';
import { Mutation__GambitWorkspaceCreate__output_type } from './output_type.ts';
import { GambitWorkspaceCreateMutation as resolver } from '../../../../mutations/GambitWorkspaceCreate.tsx';

const readerAst: ReaderAst<Mutation__GambitWorkspaceCreate__param> = [
  {
    kind: "Linked",
    fieldName: "gambitWorkspaceCreate",
    alias: null,
    arguments: null,
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
        ],
      },
      {
        kind: "Linked",
        fieldName: "workspaces",
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
                    fieldName: "deck",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "deckSlug",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "testBotName",
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
                  {
                    kind: "Scalar",
                    fieldName: "sessionDir",
                    alias: null,
                    arguments: null,
                    isUpdatable: false,
                  },
                  {
                    kind: "Scalar",
                    fieldName: "sqlitePath",
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
];

const artifact: EagerReaderArtifact<
  Mutation__GambitWorkspaceCreate__param,
  Mutation__GambitWorkspaceCreate__output_type
> = {
  kind: "EagerReaderArtifact",
  fieldName: "GambitWorkspaceCreate",
  resolver,
  readerAst,
  hasUpdatable: false,
};

export default artifact;
