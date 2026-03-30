export type Query__EntrypointSimulatorBuildPage__raw_response_type = {
  workspace____id___v_workspaceId: {
    id: string,
    files____first___l_200: {
      edges: ReadonlyArray<{
        node: {
          id: string,
          content?: (string | null),
          modifiedAt?: (string | null),
          path: string,
          size?: (number | null),
        },
      }>,
    },
  },
}

