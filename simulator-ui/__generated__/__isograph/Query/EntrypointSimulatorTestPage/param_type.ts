import { type Workspace__TestTab__output_type } from '../../Workspace/TestTab/output_type.ts';
import type { Query__EntrypointSimulatorTestPage__parameters } from './parameters_type.ts';

export type Query__EntrypointSimulatorTestPage__param = {
  readonly data: {
    readonly workspace: ({
      readonly TestTab: Workspace__TestTab__output_type,
    } | null),
  },
  readonly parameters: Query__EntrypointSimulatorTestPage__parameters,
};
