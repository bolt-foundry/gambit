import { iso } from "@iso-gambit-sim";
import React from "react";
import { AppShell } from "../../../src/AppShell.tsx";

function WorkbenchUnavailable(_: { open: boolean }) {
  return null;
}

export const SimulatorAppShell = iso(`
  field Query.SimulatorAppShell @component {
    SimulatorAppDrawer
  }
`)(function SimulatorAppShell({ data }, componentProps: {
  children: React.ReactNode;
}) {
  const Drawer = data.SimulatorAppDrawer;
  return (
    <AppShell Drawer={Drawer} Workbench={WorkbenchUnavailable}>
      {componentProps.children}
    </AppShell>
  );
});

export default SimulatorAppShell;
