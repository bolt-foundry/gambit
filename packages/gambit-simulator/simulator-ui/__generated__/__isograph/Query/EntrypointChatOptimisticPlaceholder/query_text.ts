export default 'query EntrypointChatOptimisticPlaceholder($optimisticMessage: ID!) {\
  __typename,\
  workspace____id___v_optimisticMessage: workspace(id: $optimisticMessage) {\
    id,\
  },\
}';