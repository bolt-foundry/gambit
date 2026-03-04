export type Mutation__GambitWorkspaceBuildRunCreate__parameters = {
  readonly input: {
    readonly inputItems: ReadonlyArray<{
          readonly content: string,
          readonly role?: (string | null),
        }>,
    readonly workspaceId: string,
  },
};
