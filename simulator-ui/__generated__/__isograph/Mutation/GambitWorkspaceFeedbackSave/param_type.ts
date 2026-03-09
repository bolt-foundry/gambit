import type { Mutation__GambitWorkspaceFeedbackSave__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceFeedbackSave__param = {
  readonly data: {
    readonly workspaceFeedbackSave: {
      readonly deleted: boolean,
      readonly feedback: ({
        readonly id: string,
        readonly runId: string,
        readonly messageRefId: string,
        readonly score: number,
        readonly reason: (string | null),
        readonly createdAt: (string | null),
      } | null),
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
                            readonly messageRefId: (string | null),
                            readonly role: string,
                            readonly content: string,
                            readonly feedback: ({
                              readonly id: string,
                              readonly runId: string,
                              readonly messageRefId: string,
                              readonly score: number,
                              readonly reason: (string | null),
                              readonly createdAt: (string | null),
                            } | null),
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
                      readonly messageRefId: (string | null),
                      readonly role: string,
                      readonly content: string,
                      readonly feedback: ({
                        readonly id: string,
                        readonly runId: string,
                        readonly messageRefId: string,
                        readonly score: number,
                        readonly reason: (string | null),
                        readonly createdAt: (string | null),
                      } | null),
                    } | null),
                  },
                }>,
              },
            },
          }>,
        },
      },
    },
  },
  readonly parameters: Mutation__GambitWorkspaceFeedbackSave__parameters,
};
