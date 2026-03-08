export type Mutation__GambitWorkspaceCreate__raw_response_type = {
  gambitWorkspaceCreate: {
    workspace: {
      id: string,
    },
    workspaces____first___l_200: {
      edges: ReadonlyArray<{
        node: {
          id: string,
          createdAt?: (string | null),
          deck?: (string | null),
          deckSlug?: (string | null),
          sessionDir?: (string | null),
          statePath?: (string | null),
          testBotName?: (string | null),
        },
      }>,
    },
  },
}

