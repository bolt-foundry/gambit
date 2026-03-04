import type { Mutation__GambitSimulatorStopRun__parameters } from './parameters_type.ts';

export type Mutation__GambitSimulatorStopRun__param = {
  readonly data: {
    readonly simulatorStopRun: ({
      readonly workspace: ({
        readonly id: (string | null),
        readonly buildRuns: ({
          readonly edges: (ReadonlyArray<({
            readonly node: ({
              readonly id: (string | null),
              readonly status: (string | null),
              readonly openResponses: ({
                readonly edges: (ReadonlyArray<({
                  readonly node: ({
                    readonly id: (string | null),
                    readonly status: (string | null),
                    readonly outputItems: ({
                      readonly edges: (ReadonlyArray<({
                        readonly node: ({
                          /**
A discriminant for the OpenResponseOutputItem type
                          */
                          readonly __typename: string,
                          /**
A client pointer for the OutputMessage type.
                          */
                          readonly asOutputMessage: ({
                            readonly id: (string | null),
                            readonly role: (string | null),
                            readonly content: (string | null),
                          } | null),
                          /**
A client pointer for the OutputReasoning type.
                          */
                          readonly asOutputReasoning: ({
                            readonly id: (string | null),
                            readonly summary: (string | null),
                            readonly reasoningType: (string | null),
                          } | null),
                          /**
A client pointer for the OutputToolCall type.
                          */
                          readonly asOutputToolCall: ({
                            readonly id: (string | null),
                            readonly toolCallId: (string | null),
                            readonly toolName: (string | null),
                            readonly status: (string | null),
                            readonly argumentsText: (string | null),
                            readonly resultText: (string | null),
                            readonly error: (string | null),
                          } | null),
                        } | null),
                      } | null)> | null),
                    } | null),
                  } | null),
                } | null)> | null),
              } | null),
            } | null),
          } | null)> | null),
        } | null),
      } | null),
      readonly run: ({
        readonly id: (string | null),
        readonly status: (string | null),
        readonly openResponses: ({
          readonly edges: (ReadonlyArray<({
            readonly node: ({
              readonly id: (string | null),
              readonly status: (string | null),
              readonly outputItems: ({
                readonly edges: (ReadonlyArray<({
                  readonly node: ({
                    /**
A discriminant for the OpenResponseOutputItem type
                    */
                    readonly __typename: string,
                    /**
A client pointer for the OutputMessage type.
                    */
                    readonly asOutputMessage: ({
                      readonly id: (string | null),
                      readonly role: (string | null),
                      readonly content: (string | null),
                    } | null),
                    /**
A client pointer for the OutputReasoning type.
                    */
                    readonly asOutputReasoning: ({
                      readonly id: (string | null),
                      readonly summary: (string | null),
                      readonly reasoningType: (string | null),
                    } | null),
                    /**
A client pointer for the OutputToolCall type.
                    */
                    readonly asOutputToolCall: ({
                      readonly id: (string | null),
                      readonly toolCallId: (string | null),
                      readonly toolName: (string | null),
                      readonly status: (string | null),
                      readonly argumentsText: (string | null),
                      readonly resultText: (string | null),
                      readonly error: (string | null),
                    } | null),
                  } | null),
                } | null)> | null),
              } | null),
            } | null),
          } | null)> | null),
        } | null),
      } | null),
    } | null),
  },
  readonly parameters: Mutation__GambitSimulatorStopRun__parameters,
};
