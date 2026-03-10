import type { Query__EntrypointWorkspaceTestLiveWrite__parameters } from './parameters_type.ts';

export type Query__EntrypointWorkspaceTestLiveWrite__param = {
  readonly data: {
    readonly workspace: {
      readonly id: string,
      readonly scenarioDecks: ReadonlyArray<{
        readonly id: string,
        readonly label: string,
        readonly description: (string | null),
        readonly path: string,
        readonly maxTurns: (number | null),
        readonly inputSchema: (string | null),
        readonly defaults: (string | null),
        readonly inputSchemaError: (string | null),
      }>,
      readonly assistantDeck: ({
        readonly deck: (string | null),
        readonly startMode: (string | null),
        readonly modelParams: (string | null),
        readonly inputSchema: (string | null),
        readonly defaults: (string | null),
        readonly tools: (string | null),
        readonly inputSchemaError: (string | null),
      } | null),
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
  },
  readonly parameters: Query__EntrypointWorkspaceTestLiveWrite__parameters,
};
