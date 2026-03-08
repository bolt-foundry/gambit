import type { Mutation__GambitWorkspaceBuildRunCreate__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceBuildRunCreate__param = {
  readonly data: {
    readonly workspaceBuildRunCreate: {
      readonly workspace: {
        readonly id: string,
        readonly buildRuns: {
          readonly edges: ReadonlyArray<{
            readonly node: {
              readonly id: string,
              readonly status: string,
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
                          /**
A client pointer for the OutputReasoning type.
                          */
                          readonly asOutputReasoning: ({
                            readonly id: string,
                            readonly summary: string,
                            readonly reasoningType: (string | null),
                          } | null),
                          /**
A client pointer for the OutputToolCall type.
                          */
                          readonly asOutputToolCall: ({
                            readonly id: string,
                            readonly toolCallId: string,
                            readonly toolName: string,
                            readonly status: string,
                            readonly argumentsText: (string | null),
                            readonly resultText: (string | null),
                            readonly error: (string | null),
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
        readonly status: string,
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
                    /**
A client pointer for the OutputReasoning type.
                    */
                    readonly asOutputReasoning: ({
                      readonly id: string,
                      readonly summary: string,
                      readonly reasoningType: (string | null),
                    } | null),
                    /**
A client pointer for the OutputToolCall type.
                    */
                    readonly asOutputToolCall: ({
                      readonly id: string,
                      readonly toolCallId: string,
                      readonly toolName: string,
                      readonly status: string,
                      readonly argumentsText: (string | null),
                      readonly resultText: (string | null),
                      readonly error: (string | null),
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
  readonly parameters: Mutation__GambitWorkspaceBuildRunCreate__parameters,
};
