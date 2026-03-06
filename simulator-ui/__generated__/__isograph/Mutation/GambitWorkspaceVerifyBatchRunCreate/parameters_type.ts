export type Mutation__GambitWorkspaceVerifyBatchRunCreate__parameters = {
  readonly input: {
    readonly concurrency: number,
    readonly graderId: string,
    readonly graderRepeatsPerScenario: number,
    readonly scenarioDeckId?: (string | null),
    readonly scenarioRuns: number,
    readonly workspaceId: string,
  },
};
