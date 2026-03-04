import type { ReactNode } from "react";
import PageGrid from "../gds/PageGrid.tsx";
import PageShell from "../gds/PageShell.tsx";
import Panel from "../gds/Panel.tsx";

export function GradeTabShell(props: {
  runner: ReactNode;
  results: ReactNode;
}) {
  return (
    <PageShell className="calibrate-shell">
      <PageGrid as="main" className="calibrate-layout">
        <Panel
          className="calibrate-runner"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {props.runner}
        </Panel>
        <Panel
          className="calibrate-results"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {props.results}
        </Panel>
      </PageGrid>
    </PageShell>
  );
}

export default GradeTabShell;
