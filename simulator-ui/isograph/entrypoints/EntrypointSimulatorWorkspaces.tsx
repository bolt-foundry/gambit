import { iso } from "@iso-gambit-sim";

export const EntrypointSimulatorWorkspaces = iso(`
  field Query.EntrypointSimulatorWorkspaces {
    SimulatorAppShell
    SimulatorWorkspacesPage
  }
`)(function EntrypointSimulatorWorkspaces({ data }) {
  const WorkspaceBody = data.SimulatorWorkspacesPage;
  const Shell = data.SimulatorAppShell;
  function Body() {
    return (
      <Shell>
        <WorkspaceBody />
      </Shell>
    );
  }

  return {
    Body,
    title: "Gambit Workspaces",
  };
});

export default EntrypointSimulatorWorkspaces;
