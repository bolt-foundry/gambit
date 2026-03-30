import { iso } from "@iso-gambit-sim";

function EntrypointBodyFallback() {
  const pathname = globalThis.location?.pathname ?? "/";
  return (
    <div className="app-shell">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Build</h2>
        <p className="status-indicator">
          Recovering entrypoint body for <code>{pathname}</code>
        </p>
      </div>
    </div>
  );
}

export const EntrypointSimulatorRoot = iso(`
  field Query.EntrypointSimulatorRoot {
    SimulatorRootPage
  }
`)(function EntrypointSimulatorRoot({ data }) {
  const Body = data.SimulatorRootPage ?? EntrypointBodyFallback;
  return {
    Body,
    title: "Gambit Simulator",
  };
});

export default EntrypointSimulatorRoot;
