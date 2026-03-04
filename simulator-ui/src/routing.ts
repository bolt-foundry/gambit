import {
  entrypointSimulatorRedirect,
  entrypointSimulatorWorkspaces,
  entrypointSimulatorWorkspaceShell,
} from "../__generated__/builtRoutes.ts";

type MatchedRoute = {
  match: boolean;
  params: Record<string, string>;
  queryParams: Record<string, string>;
};

const routePatternCache = new Map<string, URLPattern>();

export function stripQueryFromPath(path: string): string {
  if (!path) return "/";
  const [withoutQuery] = path.split("?");
  const [pathname] = withoutQuery.split("#");
  return pathname || "/";
}

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/$/, "") || "/";
}

export function matchRouteWithParams(
  pathRaw = "",
  pathTemplate?: string,
): MatchedRoute {
  const parsed = (() => {
    try {
      return new URL(pathRaw || "/", "https://gambit.local");
    } catch {
      return new URL("/", "https://gambit.local");
    }
  })();
  const rawPath = normalizePathname(parsed.pathname);
  const queryParams = Object.fromEntries(parsed.searchParams.entries());

  if (!pathTemplate) {
    return { match: false, params: {}, queryParams };
  }

  const normalizedTemplate = normalizePathname(pathTemplate);
  const patternPath = normalizedTemplate.endsWith("/*")
    ? `${normalizedTemplate.slice(0, -2)}/:__splat*`
    : normalizedTemplate;
  const cacheKey = `${normalizedTemplate}::${patternPath}`;
  const pattern = routePatternCache.get(cacheKey) ??
    (() => {
      const created = new URLPattern({ pathname: patternPath });
      routePatternCache.set(cacheKey, created);
      return created;
    })();
  const match = pattern.exec({ pathname: rawPath });
  if (!match) {
    return { match: false, params: {}, queryParams };
  }

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(match.pathname.groups)) {
    if (key === "__splat") continue;
    if (typeof value === "string") {
      params[key] = value;
    }
  }

  return { match: true, params, queryParams };
}

export const isographAppRoutes = new Map<string, unknown>([
  ["/", entrypointSimulatorRedirect],
  ["/build", entrypointSimulatorRedirect],
  ["/isograph", entrypointSimulatorRedirect],
  ["/isograph/build", entrypointSimulatorRedirect],
  ["/workspaces", entrypointSimulatorWorkspaces],
  ["/workspaces/new", entrypointSimulatorWorkspaces],
  ["/workspaces/:workspaceId", entrypointSimulatorRedirect],
  ["/workspaces/:workspaceId/build/:path*", entrypointSimulatorWorkspaceShell],
  ["/workspaces/:workspaceId/build", entrypointSimulatorWorkspaceShell],
  [
    "/workspaces/:workspaceId/test/:testRunId",
    entrypointSimulatorWorkspaceShell,
  ],
  ["/workspaces/:workspaceId/test", entrypointSimulatorWorkspaceShell],
  [
    "/workspaces/:workspaceId/grade/:gradeRunId",
    entrypointSimulatorWorkspaceShell,
  ],
  ["/workspaces/:workspaceId/grade", entrypointSimulatorWorkspaceShell],
  ["/workspaces/:workspaceId/verify", entrypointSimulatorWorkspaceShell],
  ["/isograph/workspaces", entrypointSimulatorWorkspaces],
  ["/isograph/workspaces/new", entrypointSimulatorWorkspaces],
  ["/isograph/workspaces/:workspaceId", entrypointSimulatorRedirect],
  [
    "/isograph/workspaces/:workspaceId/build/:path*",
    entrypointSimulatorWorkspaceShell,
  ],
  [
    "/isograph/workspaces/:workspaceId/build",
    entrypointSimulatorWorkspaceShell,
  ],
  [
    "/isograph/workspaces/:workspaceId/test/:testRunId",
    entrypointSimulatorWorkspaceShell,
  ],
  ["/isograph/workspaces/:workspaceId/test", entrypointSimulatorWorkspaceShell],
  [
    "/isograph/workspaces/:workspaceId/grade/:gradeRunId",
    entrypointSimulatorWorkspaceShell,
  ],
  [
    "/isograph/workspaces/:workspaceId/grade",
    entrypointSimulatorWorkspaceShell,
  ],
  [
    "/isograph/workspaces/:workspaceId/verify",
    entrypointSimulatorWorkspaceShell,
  ],
]);
