import type { Mutation__GambitWorkspaceConversationSessionSend__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceConversationSessionSend__param = {
  readonly data: {
    readonly workspaceConversationSessionSend: {
      readonly session: {
        /**
A discriminant for the WorkspaceConversationSession type
        */
        readonly __typename: string,
        readonly sessionId: string,
        readonly status: string,
        /**
A client pointer for the WorkspaceBuildConversationSession type.
        */
        readonly asWorkspaceBuildConversationSession: ({
          readonly run: {
            readonly id: string,
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
        } | null),
        /**
A client pointer for the WorkspaceScenarioConversationSession type.
        */
        readonly asWorkspaceScenarioConversationSession: ({
          readonly run: {
            readonly id: string,
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
        } | null),
      },
      readonly workspace: {
        readonly id: string,
      },
    },
  },
  readonly parameters: Mutation__GambitWorkspaceConversationSessionSend__parameters,
};
