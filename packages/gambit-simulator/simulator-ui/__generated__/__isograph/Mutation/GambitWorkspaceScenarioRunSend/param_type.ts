import type { Mutation__GambitWorkspaceScenarioRunSend__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceScenarioRunSend__param = {
  readonly data: {
    readonly workspaceScenarioRunSend: {
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
                  readonly feedback: ({
                    readonly id: string,
                    readonly runId: string,
                    readonly messageRefId: string,
                    readonly score: number,
                    readonly reason: (string | null),
                    readonly createdAt: (string | null),
                  } | null),
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
            readonly feedback: ({
              readonly id: string,
              readonly runId: string,
              readonly messageRefId: string,
              readonly score: number,
              readonly reason: (string | null),
              readonly createdAt: (string | null),
            } | null),
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
  readonly parameters: Mutation__GambitWorkspaceScenarioRunSend__parameters,
};
