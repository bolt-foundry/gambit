export default 'mutation GambitWorkspaceCreate {\
  gambitWorkspaceCreate {\
    workspace {\
      id,\
    },\
    workspaces____first___l_200: workspaces(first: 200) {\
      edges {\
        node {\
          id,\
          createdAt,\
          deck,\
          deckSlug,\
          sessionDir,\
          sqlitePath,\
          testBotName,\
        },\
      },\
    },\
  },\
}';