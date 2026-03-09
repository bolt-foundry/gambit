import { iso } from "@iso-gambit-sim";
import entrypointSimulatorBuildPage from "@iso-gambit-sim/Query/EntrypointSimulatorBuildPage/entrypoint.ts";
import entrypointSimulatorGradePage from "@iso-gambit-sim/Query/EntrypointSimulatorGradePage/entrypoint.ts";
import entrypointSimulatorTestPage from "@iso-gambit-sim/Query/EntrypointSimulatorTestPage/entrypoint.ts";
import entrypointSimulatorVerifyPage from "@iso-gambit-sim/Query/EntrypointSimulatorVerifyPage/entrypoint.ts";
import { parseWorkspaceRoute } from "../../../src/workspace_routes.ts";
import { AppIsoMinimal } from "../../src/AppIsoMinimal.tsx";
import { useRouter } from "../../src/RouterContext.tsx";
import Panel from "../../src/gds/Panel.tsx";

function isThenable(value: unknown): value is Promise<unknown> {
  return !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function";
}

function toWorkspaceRoutePath(path: string): string {
  if (path === "/isograph" || path.startsWith("/isograph/")) {
    const stripped = path.slice("/isograph".length);
    return stripped.length > 0 ? stripped : "/";
  }
  return path;
}

function WorkspaceMainPane(props: { workspaceId: string }) {
  const { currentRoutePath } = useRouter();
  const workspaceRoutePath = toWorkspaceRoutePath(currentRoutePath);
  const route = parseWorkspaceRoute(workspaceRoutePath);
  const tab = route?.tab === "test" || route?.tab === "grade" ||
      route?.tab === "verify"
    ? route.tab
    : "build";
  const entrypoint = tab === "test"
    ? entrypointSimulatorTestPage
    : tab === "grade"
    ? entrypointSimulatorGradePage
    : tab === "verify"
    ? entrypointSimulatorVerifyPage
    : entrypointSimulatorBuildPage;
  return (
    <AppIsoMinimal
      key={`workspace-main:${props.workspaceId}:${tab}`}
      entrypoint={entrypoint}
      params={{ workspaceId: props.workspaceId }}
      fallback={
        <Panel>
          <div className="editor-status">Loading workspace tab…</div>
        </Panel>
      }
    />
  );
}

export const EntrypointSimulatorWorkspaceShell = iso(`
  field Query.EntrypointSimulatorWorkspaceShell($workspaceId: ID!) {
    SimulatorBuildContentShell(workspaceId: $workspaceId)
    workspace(id: $workspaceId) {
      id
    }
  }
`)(function EntrypointSimulatorWorkspaceShell({ data }) {
  if (!data.workspace || typeof data.workspace.id !== "string") {
    return {
      Body: null,
      title: "Gambit Simulator",
      status: 404,
    };
  }

  const Shell = data.SimulatorBuildContentShell;
  const workspaceId = data.workspace.id;
  function Body() {
    if (isThenable(Shell)) {
      throw Shell;
    }
    if (!Shell) return null;
    return (
      <Shell>
        <WorkspaceMainPane workspaceId={workspaceId} />
      </Shell>
    );
  }

  return {
    Body,
    title: "Gambit Simulator",
  };
});

export default EntrypointSimulatorWorkspaceShell;
