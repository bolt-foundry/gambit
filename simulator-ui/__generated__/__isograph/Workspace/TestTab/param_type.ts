import type { StartUpdate } from '@isograph/react';

export type Workspace__TestTab__param = {
  readonly data: {
    readonly id: string,
    /**
Client-exclusive ephemeral workbench chip selection. This field exists for Isograph-owned simulator state until durable persistence is needed.
    */
    readonly workbenchSelectedContextChips: string,
    readonly sqlitePath: (string | null),
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
  readonly parameters: Record<PropertyKey, never>,
  readonly startUpdate: StartUpdate<{
    readonly id: string,
    /**
Client-exclusive ephemeral workbench chip selection. This field exists for Isograph-owned simulator state until durable persistence is needed.
    */
    workbenchSelectedContextChips: string,
    readonly sqlitePath: (string | null),
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
  }>,
};
