import type { Mutation__GambitWorkspaceDelete__parameters } from './parameters_type.ts';

export type Mutation__GambitWorkspaceDelete__param = {
  readonly data: {
    readonly gambitWorkspaceDelete: {
      readonly deleted: boolean,
      readonly error: (string | null),
    },
  },
  readonly parameters: Mutation__GambitWorkspaceDelete__parameters,
};
