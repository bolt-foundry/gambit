import { useEffect } from "react";
import { AppIsoMinimal } from "./AppIsoMinimal.tsx";
import { isographAppRoutes, matchRouteWithParams } from "./routing.ts";
import { useRouter } from "./RouterContext.tsx";

export function MinimalRouterRoot() {
  const { currentPath, queryParams, navigate } = useRouter();
  const isoMatch = Array.from(isographAppRoutes).find(([pattern]) =>
    matchRouteWithParams(currentPath, pattern).match
  );
  useEffect(() => {
    if (!currentPath.startsWith("/isograph")) return;
    if (!isoMatch) return;
    const [pattern] = isoMatch;
    // deno-lint-ignore no-console
    console.log("[gambit:isograph] route matched", {
      currentPath,
      pattern,
    });
  }, [currentPath, isoMatch]);

  if (isoMatch) {
    const [pattern, entrypoint] = isoMatch;
    const match = matchRouteWithParams(currentPath, pattern);
    const rawParams = { ...match.params, ...queryParams };
    const isWorkspaceShellRoute =
      pattern.startsWith("/workspaces/:workspaceId/build") ||
      pattern.startsWith("/workspaces/:workspaceId/test") ||
      pattern.startsWith("/isograph/workspaces/:workspaceId/build") ||
      pattern.startsWith("/isograph/workspaces/:workspaceId/test");
    const params = isWorkspaceShellRoute &&
        typeof rawParams.workspaceId === "string" &&
        rawParams.workspaceId.length > 0
      ? { workspaceId: rawParams.workspaceId }
      : rawParams;
    const routeInstanceKey = isWorkspaceShellRoute &&
        typeof params.workspaceId === "string" &&
        params.workspaceId.length > 0
      ? `workspace:${params.workspaceId}`
      : `${pattern}|${currentPath}`;
    return (
      <AppIsoMinimal
        // deno-lint-ignore no-explicit-any
        entrypoint={entrypoint as any}
        params={params}
        onNavigate={navigate}
        rendererKey={routeInstanceKey}
      />
    );
  }

  return <div style={{ padding: 16 }}>Not found</div>;
}
