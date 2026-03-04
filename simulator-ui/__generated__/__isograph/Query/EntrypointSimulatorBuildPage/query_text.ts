export default 'query EntrypointSimulatorBuildPage($workspaceId: ID!) {\
  workspace____id___v_workspaceId: workspace(id: $workspaceId) {\
    id,\
    files____first___l_200: files(first: 200) {\
      edges {\
        node {\
          id,\
          content,\
          modifiedAt,\
          path,\
          size,\
        },\
      },\
    },\
  },\
}';