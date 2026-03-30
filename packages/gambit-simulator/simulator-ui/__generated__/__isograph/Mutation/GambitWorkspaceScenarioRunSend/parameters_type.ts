export type Mutation__GambitWorkspaceScenarioRunSend__parameters = {
  readonly input: {
    readonly inputItems: ReadonlyArray<{
          readonly content: string,
          readonly role?: (string | null),
        }>,
    readonly runId: string,
    readonly workspaceId: string,
  },
};
