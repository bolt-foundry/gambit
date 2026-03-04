import { iso } from "@iso-gambit-sim";

function isThenable(value: unknown): value is Promise<unknown> {
  return !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function";
}

export const EntrypointSimulatorGradePage = iso(`
  field Query.EntrypointSimulatorGradePage($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      GradeTab
    }
  }
`)(function EntrypointSimulatorGradePage({ data }) {
  if (!data.workspace) {
    return {
      Body: null,
      title: "Gambit Simulator",
      status: 404,
    };
  }

  const GradeTab = data.workspace.GradeTab;

  function Body() {
    if (isThenable(GradeTab)) {
      throw GradeTab;
    }
    if (!GradeTab) return null;
    return <GradeTab />;
  }

  return {
    Body,
    title: "Gambit Simulator",
  };
});

export default EntrypointSimulatorGradePage;
