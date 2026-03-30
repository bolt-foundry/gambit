import type { Mutation__GambitWorkspaceScenarioRunStop__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceScenarioRunStop__param = {
  readonly data: {
    readonly workspaceScenarioRunStop: {
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
              readonly transcriptEntries: ReadonlyArray<{
                /**
A client pointer for the WorkspaceConversationTranscriptMessage type.
                */
                readonly asWorkspaceConversationTranscriptMessage: ({
                  readonly id: string,
                  readonly messageRefId: (string | null),
                  readonly feedbackEligible: boolean,
                  readonly role: string,
                  readonly content: string,
                } | null),
                /**
A client pointer for the WorkspaceConversationTranscriptReasoning type.
                */
                readonly asWorkspaceConversationTranscriptReasoning: ({
                  readonly id: string,
                  readonly summary: string,
                  readonly reasoningType: (string | null),
                } | null),
                /**
A client pointer for the WorkspaceConversationTranscriptToolCall type.
                */
                readonly asWorkspaceConversationTranscriptToolCall: ({
                  readonly id: string,
                  readonly toolCallId: string,
                  readonly toolName: string,
                  readonly status: string,
                  readonly argumentsText: (string | null),
                  readonly resultText: (string | null),
                  readonly error: (string | null),
                } | null),
              }>,
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
        readonly transcriptEntries: ReadonlyArray<{
          /**
A client pointer for the WorkspaceConversationTranscriptMessage type.
          */
          readonly asWorkspaceConversationTranscriptMessage: ({
            readonly id: string,
            readonly messageRefId: (string | null),
            readonly feedbackEligible: boolean,
            readonly role: string,
            readonly content: string,
          } | null),
          /**
A client pointer for the WorkspaceConversationTranscriptReasoning type.
          */
          readonly asWorkspaceConversationTranscriptReasoning: ({
            readonly id: string,
            readonly summary: string,
            readonly reasoningType: (string | null),
          } | null),
          /**
A client pointer for the WorkspaceConversationTranscriptToolCall type.
          */
          readonly asWorkspaceConversationTranscriptToolCall: ({
            readonly id: string,
            readonly toolCallId: string,
            readonly toolName: string,
            readonly status: string,
            readonly argumentsText: (string | null),
            readonly resultText: (string | null),
            readonly error: (string | null),
          } | null),
        }>,
      },
    },
  },
  readonly parameters: Mutation__GambitWorkspaceScenarioRunStop__parameters,
};
