import type { Mutation__GambitSimulatorResetWorkspace__parameters } from './parameters_type.ts';

export type Mutation__GambitSimulatorResetWorkspace__param = {
  readonly data: {
    readonly simulatorResetWorkspace: {
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
      readonly build: {
        readonly workspaceId: string,
        readonly runStatus: string,
        readonly canSend: boolean,
        readonly canStop: boolean,
      },
    },
  },
  readonly parameters: Mutation__GambitSimulatorResetWorkspace__parameters,
};
