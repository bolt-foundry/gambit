export default 'query EntrypointSimulatorWorkspaces {\
  gambitWorkspaces____first___l_200: gambitWorkspaces(first: 200) {\
    edges {\
      node {\
        id,\
        createdAt,\
        deck,\
        deckSlug,\
        sessionDir,\
        statePath,\
        testBotName,\
      },\
    },\
  },\
}';