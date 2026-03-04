import { iso } from "@iso-gambit-sim";

function isThenable(value: unknown): value is Promise<unknown> {
  return !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function";
}

export const EntrypointSimulatorBuildPage = iso(`
  field Query.EntrypointSimulatorBuildPage($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      BuildTab
    }
  }
`)(function EntrypointSimulatorBuildPage({ data }) {
  if (!data.workspace) {
    return {
      Body: null,
      title: "Gambit Simulator",
      status: 404,
    };
  }

  const BuildTab = data.workspace.BuildTab;

  function Body() {
    if (isThenable(BuildTab)) {
      throw BuildTab;
    }
    if (!BuildTab) return null;
    return <BuildTab />;
  }

  return {
    Body,
    title: "Gambit Simulator",
  };
});

export default EntrypointSimulatorBuildPage;
