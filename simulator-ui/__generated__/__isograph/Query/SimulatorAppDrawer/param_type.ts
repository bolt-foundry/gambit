
export type Query__SimulatorAppDrawer__param = {
  readonly data: {
    readonly gambitWorkspaces: {
      readonly edges: ReadonlyArray<{
        readonly node: {
          readonly id: string,
          readonly deck: (string | null),
          readonly deckSlug: (string | null),
          readonly testBotName: (string | null),
          readonly createdAt: (string | null),
          readonly sessionDir: (string | null),
          readonly sqlitePath: (string | null),
        },
      }>,
    },
  },
  readonly parameters: Record<PropertyKey, never>,
};
