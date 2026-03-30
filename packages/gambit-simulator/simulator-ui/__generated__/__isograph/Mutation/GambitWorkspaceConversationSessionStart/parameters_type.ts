export type Mutation__GambitWorkspaceConversationSessionStart__parameters = {
  readonly input: {
    readonly assistantInit?: (string | null),
    readonly concurrency?: (number | null),
    readonly graderId?: (string | null),
    readonly graderRepeatsPerScenario?: (number | null),
    readonly inputItems?: (ReadonlyArray<{
            readonly content: string,
            readonly role?: (string | null),
          }> | null),
    readonly kind: string,
    readonly scenarioDeckId?: (string | null),
    readonly scenarioInput?: (string | null),
    readonly scenarioRunId?: (string | null),
    readonly scenarioRuns?: (number | null),
    readonly sessionId?: (string | null),
    readonly workspaceId: string,
  },
};
