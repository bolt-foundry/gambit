import { iso } from "@iso-gambit-sim";

export const EntrypointChatOptimisticPlaceholder = iso(`
  field Query.EntrypointChatOptimisticPlaceholder($optimisticMessage: ID!) {
    optimisticMessageCarrier: __typename
    optimisticMessageWorkspaceProbe: workspace(id: $optimisticMessage) {
      id
    }
  }
`)(function EntrypointChatOptimisticPlaceholder({ data, parameters }) {
  return {
    optimisticMessage: parameters.optimisticMessage ??
      data.optimisticMessageCarrier,
  };
});

export default EntrypointChatOptimisticPlaceholder;
