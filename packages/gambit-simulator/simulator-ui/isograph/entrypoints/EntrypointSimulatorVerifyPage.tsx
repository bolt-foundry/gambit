import { iso } from "@iso-gambit-sim";

function isThenable(value: unknown): value is Promise<unknown> {
  return !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function";
}

export const EntrypointSimulatorVerifyPage = iso(`
  field Query.EntrypointSimulatorVerifyPage($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      VerifyTab
    }
  }
`)(function EntrypointSimulatorVerifyPage({ data }) {
  if (!data.workspace) {
    return {
      Body: null,
      title: "Gambit Simulator",
      status: 404,
    };
  }

  const VerifyTab = data.workspace.VerifyTab;

  function Body() {
    if (isThenable(VerifyTab)) {
      throw VerifyTab;
    }
    if (!VerifyTab) return null;
    return <VerifyTab />;
  }

  return {
    Body,
    title: "Gambit Simulator",
  };
});

export default EntrypointSimulatorVerifyPage;
