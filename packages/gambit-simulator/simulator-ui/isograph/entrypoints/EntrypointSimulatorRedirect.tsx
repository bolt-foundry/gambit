import { iso } from "@iso-gambit-sim";

export const EntrypointSimulatorRedirect = iso(`
  field Query.EntrypointSimulatorRedirect {
    SimulatorRootPage
  }
`)(function EntrypointSimulatorRedirect() {
  const currentPath = (() => {
    if (
      typeof globalThis.location?.pathname === "string" &&
      globalThis.location.pathname.length > 0
    ) {
      return globalThis.location.pathname;
    }
    const globals = globalThis as typeof globalThis & {
      __GAMBIT_CURRENT_PATH__?: unknown;
    };
    return typeof globals.__GAMBIT_CURRENT_PATH__ === "string"
      ? globals.__GAMBIT_CURRENT_PATH__
      : "/";
  })();

  if (
    currentPath === "/" || currentPath === "/build" ||
    currentPath === "/debug" || currentPath === "/simulate"
  ) {
    return {
      Body: null,
      title: "Gambit Simulator",
      status: 302,
      headers: { Location: "/workspaces" },
    };
  }

  const bareWorkspaceMatch = currentPath.match(/^\/workspaces\/([^/]+)$/);
  if (bareWorkspaceMatch && bareWorkspaceMatch[1] !== "new") {
    const workspaceId = (() => {
      try {
        return encodeURIComponent(decodeURIComponent(bareWorkspaceMatch[1]));
      } catch {
        return encodeURIComponent(bareWorkspaceMatch[1]);
      }
    })();
    return {
      Body: null,
      title: "Gambit Simulator",
      status: 302,
      headers: { Location: `/workspaces/${workspaceId}/build` },
    };
  }

  return {
    Body: null,
    title: "Gambit Simulator",
    status: 302,
    headers: { Location: "/workspaces" },
  };
});

export default EntrypointSimulatorRedirect;
