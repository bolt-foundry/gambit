import { type Query__SimulatorAppDrawer__output_type } from '../../Query/SimulatorAppDrawer/output_type.ts';
import { type Workspace__WorkbenchChatDrawer__output_type } from '../../Workspace/WorkbenchChatDrawer/output_type.ts';
import type { Query__SimulatorBuildContentShell__parameters } from './parameters_type.ts';

export type Query__SimulatorBuildContentShell__param = {
  readonly data: {
    readonly SimulatorAppDrawer: Query__SimulatorAppDrawer__output_type,
    readonly workspace: ({
      readonly WorkbenchChatDrawer: Workspace__WorkbenchChatDrawer__output_type,
    } | null),
  },
  readonly parameters: Query__SimulatorBuildContentShell__parameters,
};
