export type Mutation__GambitWorkspaceBuildRunCreate__parameters = {
  readonly input: {
    readonly buildChatProvider?: (string | null),
    readonly inputItems: ReadonlyArray<{
          readonly content: string,
          readonly role?: (string | null),
        }>,
    readonly workspaceId: string,
  },
};
