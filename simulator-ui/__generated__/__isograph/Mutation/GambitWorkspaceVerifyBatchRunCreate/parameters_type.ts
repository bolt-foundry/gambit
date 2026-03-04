export type Mutation__GambitWorkspaceVerifyBatchRunCreate__parameters = {
  readonly input: {
    readonly batchSize: number,
    readonly concurrency: number,
    readonly graderId: string,
    readonly scenarioRunId?: (string | null),
    readonly workspaceId: string,
  },
};
