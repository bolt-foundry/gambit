import type { Mutation__GambitWorkspaceScenarioRunStart__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceScenarioRunStart__param = {
  readonly data: {
    readonly workspaceScenarioRunStart: {
      readonly workspace: {
        readonly id: string,
        readonly scenarioRuns: {
          readonly edges: ReadonlyArray<{
            readonly node: {
              readonly id: string,
              readonly status: string,
              readonly startedAt: (string | null),
              readonly finishedAt: (string | null),
              readonly error: (string | null),
              readonly openResponses: {
                readonly edges: ReadonlyArray<{
                  readonly node: {
                    readonly id: string,
                    readonly status: string,
                    readonly outputItems: {
                      readonly edges: ReadonlyArray<{
                        readonly node: {
                          /**
A discriminant for the OpenResponseOutputItem type
                          */
                          readonly __typename: string,
                          /**
A client pointer for the OutputMessage type.
                          */
                          readonly asOutputMessage: ({
                            readonly id: string,
                            readonly role: string,
                            readonly content: string,
                          } | null),
                        },
                      }>,
                    },
                  },
                }>,
              },
            },
          }>,
        },
      },
      readonly run: {
        readonly id: string,
        readonly workspaceId: string,
        readonly status: string,
        readonly startedAt: (string | null),
        readonly finishedAt: (string | null),
        readonly error: (string | null),
      },
    },
  },
  readonly parameters: Mutation__GambitWorkspaceScenarioRunStart__parameters,
};
