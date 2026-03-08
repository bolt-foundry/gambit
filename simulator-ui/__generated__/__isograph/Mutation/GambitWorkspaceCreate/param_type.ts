
export type Mutation__GambitWorkspaceCreate__param = {
  readonly data: {
    readonly gambitWorkspaceCreate: {
      readonly workspace: {
        readonly id: string,
      },
      readonly workspaces: {
        readonly edges: ReadonlyArray<{
          readonly node: {
            readonly id: string,
            readonly deck: (string | null),
            readonly deckSlug: (string | null),
            readonly testBotName: (string | null),
            readonly createdAt: (string | null),
            readonly sessionDir: (string | null),
            readonly statePath: (string | null),
          },
        }>,
      },
    },
  },
  readonly parameters: Record<PropertyKey, never>,
};
