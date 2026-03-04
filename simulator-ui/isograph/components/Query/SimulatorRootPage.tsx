import { iso } from "@iso-gambit-sim";

export const SimulatorRootPage = iso(`
  field Query.SimulatorRootPage @component {
    __typename
  }
`)(function SimulatorPlaceholderPage() {
  const pathname = globalThis.location?.pathname ?? "/";
  return (
    <div className="app-shell">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Isograph Canary</h2>
        <p className="status-indicator">
          This route is rendering via Isograph entrypoint resolution.
        </p>
        <p className="status-indicator">
          Path: <code>{pathname}</code>
        </p>
      </div>
    </div>
  );
});

export const SimulatorPlaceholderPage = SimulatorRootPage;

export default SimulatorRootPage;
