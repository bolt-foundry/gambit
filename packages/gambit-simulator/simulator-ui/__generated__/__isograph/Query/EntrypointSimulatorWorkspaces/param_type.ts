import { type Query__SimulatorAppShell__output_type } from '../../Query/SimulatorAppShell/output_type.ts';
import { type Query__SimulatorWorkspacesPage__output_type } from '../../Query/SimulatorWorkspacesPage/output_type.ts';

export type Query__EntrypointSimulatorWorkspaces__param = {
  readonly data: {
    readonly SimulatorAppShell: Query__SimulatorAppShell__output_type,
    readonly SimulatorWorkspacesPage: Query__SimulatorWorkspacesPage__output_type,
  },
  readonly parameters: Record<PropertyKey, never>,
};
