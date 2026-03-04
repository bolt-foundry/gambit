import type { Query__EntrypointChatOptimisticPlaceholder__parameters } from './parameters_type.ts';

export type Query__EntrypointChatOptimisticPlaceholder__param = {
  readonly data: {
    /**
A discriminant for the Query type
    */
    readonly optimisticMessageCarrier: "Query",
    readonly optimisticMessageWorkspaceProbe: ({
      readonly id: (string | null),
    } | null),
  },
  readonly parameters: Query__EntrypointChatOptimisticPlaceholder__parameters,
};
