import { type Workspace__BuildTab__output_type } from '../../Workspace/BuildTab/output_type.ts';
import type { Query__EntrypointSimulatorBuildPage__parameters } from './parameters_type.ts';

export type Query__EntrypointSimulatorBuildPage__param = {
  readonly data: {
    readonly workspace: {
      readonly BuildTab: Workspace__BuildTab__output_type,
    },
  },
  readonly parameters: Query__EntrypointSimulatorBuildPage__parameters,
};
