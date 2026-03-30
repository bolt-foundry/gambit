import { iso } from "@iso-gambit-sim";
import React from "react";
import { AppShell } from "../../../src/AppShell.tsx";

function WorkbenchUnavailable(_: { open: boolean }) {
  return null;
}

export const SimulatorBuildContentShell = iso(`
  field Query.SimulatorBuildContentShell($workspaceId: ID!) @component {
    SimulatorAppDrawer
    workspace(id: $workspaceId) {
      WorkbenchChatDrawer
    }
  }
`)(function SimulatorBuildContentShell({ data }, componentProps: {
  children: React.ReactNode;
}) {
  const Drawer = data.SimulatorAppDrawer;
  const Workbench = data.workspace?.WorkbenchChatDrawer ?? WorkbenchUnavailable;
  return (
    <AppShell Drawer={Drawer} Workbench={Workbench}>
      {componentProps.children}
    </AppShell>
  );
});

export default SimulatorBuildContentShell;
