import { type Query__SimulatorBuildContentShell__output_type } from '../../Query/SimulatorBuildContentShell/output_type.ts';
import type { Query__EntrypointSimulatorWorkspaceShell__parameters } from './parameters_type.ts';

export type Query__EntrypointSimulatorWorkspaceShell__param = {
  readonly data: {
    readonly SimulatorBuildContentShell: Query__SimulatorBuildContentShell__output_type,
    readonly workspace: ({
      readonly id: (string | null),
    } | null),
  },
  readonly parameters: Query__EntrypointSimulatorWorkspaceShell__parameters,
};
