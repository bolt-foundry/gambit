import { iso } from "@iso-gambit-sim";

function isThenable(value: unknown): value is Promise<unknown> {
  return !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function";
}

export const EntrypointSimulatorTestPage = iso(`
  field Query.EntrypointSimulatorTestPage($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      TestTab
    }
  }
`)(function EntrypointSimulatorTestPage({ data }) {
  if (!data.workspace) {
    return {
      Body: null,
      title: "Gambit Simulator",
      status: 404,
    };
  }

  const TestTab = data.workspace.TestTab;

  function Body() {
    if (isThenable(TestTab)) {
      throw TestTab;
    }
    if (!TestTab) return null;
    return <TestTab />;
  }

  return {
    Body,
    title: "Gambit Simulator",
  };
});

export default EntrypointSimulatorTestPage;
