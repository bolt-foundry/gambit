export const WORKSPACE_STATE_SCHEMA_VERSION = "workspace-state.v1";

export const WORKSPACE_ROUTE_BASE = "/workspaces";

export type WorkspaceRouteTab = "debug" | "build" | "test" | "grade";

export const WORKSPACE_ROUTE_TABS: Array<WorkspaceRouteTab> = [
  "debug",
  "build",
  "test",
  "grade",
];

export type WorkspaceRoute = {
  workspaceId: string | null;
  tab: WorkspaceRouteTab;
  isNew: boolean;
  testRunId?: string;
  gradeRunId?: string;
};

export type WorkspaceStreamEvent =
  | {
    type: "build.stream";
    workspaceId: string;
    role: "assistant" | "user";
    chunk: string;
    turn?: number;
    ts?: number;
  }
  | {
    type: "build.stream.end";
    workspaceId: string;
    role: "assistant" | "user";
    turn?: number;
    ts?: number;
  }
  | {
    type: "test.stream";
    workspaceId: string;
    role: "assistant" | "user";
    chunk: string;
    turn?: number;
    ts?: number;
  }
  | {
    type: "test.stream.end";
    workspaceId: string;
    role: "assistant" | "user";
    turn?: number;
    ts?: number;
  }
  | {
    type: "grade.session";
    workspaceId: string;
    runId?: string;
    ts?: number;
  };

export type WorkspaceReducerEvent =
  | { type: "workspace.loaded"; workspaceId: string; state: unknown }
  | { type: "build.status"; workspaceId: string; run: unknown }
  | { type: "test.status"; workspaceId: string; run: unknown }
  | { type: "grade.status"; workspaceId: string; run: unknown }
  | WorkspaceStreamEvent;

export type WorkspaceCreateResponse = {
  workspaceId: string;
  deckPath: string;
  workspaceDir: string;
  createdAt: string;
  workspaceSchemaVersion: string;
};

export const buildWorkspacePath = (
  tab: WorkspaceRouteTab,
  workspaceId?: string | null,
  opts?: { runId?: string },
): string => {
  const encoded = workspaceId ? encodeURIComponent(workspaceId) : "new";
  const base = `${WORKSPACE_ROUTE_BASE}/${encoded}/${tab}`;
  const runId = opts?.runId;
  if (!runId) return base;
  if (tab !== "test" && tab !== "grade") return base;
  return `${base}/${encodeURIComponent(runId)}`;
};

export const parseWorkspaceRoute = (
  pathname: string,
): WorkspaceRoute | null => {
  const match = pathname.match(
    /^\/workspaces\/([^/]+)\/(debug|build|test|grade)(?:\/([^/]+))?$/,
  );
  if (!match) return null;
  const rawId = decodeURIComponent(match[1]);
  const tab = match[2] as WorkspaceRouteTab;
  const runSegment = typeof match[3] === "string"
    ? decodeURIComponent(match[3])
    : undefined;
  if (runSegment && tab !== "test" && tab !== "grade") return null;
  if (rawId === "new" && runSegment) return null;
  if (rawId === "new") {
    return { workspaceId: null, tab, isNew: true };
  }
  return {
    workspaceId: rawId,
    tab,
    isNew: false,
    testRunId: tab === "test" ? runSegment : undefined,
    gradeRunId: tab === "grade" ? runSegment : undefined,
  };
};

export const WORKSPACE_ID_ALIASES = ["workspaceId"] as const;
type WorkspaceIdAlias = typeof WORKSPACE_ID_ALIASES[number];

const readString = (
  record: Record<string, unknown>,
  key: WorkspaceIdAlias,
): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
};

export const resolveWorkspaceIdFromRecord = (
  record: Record<string, unknown>,
): string | undefined => {
  for (const key of WORKSPACE_ID_ALIASES) {
    const value = readString(record, key);
    if (value) return value;
  }
  return undefined;
};

export const resolveWorkspaceIdFromSearchParams = (
  params: URLSearchParams,
): string | undefined => {
  for (const key of WORKSPACE_ID_ALIASES) {
    const value = params.get(key);
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

export const workspaceSchemaError = (
  workspaceId: string,
  foundVersion: string | null,
): string => {
  const shown = foundVersion ? `"${foundVersion}"` : "missing";
  return [
    `Unsupported workspace state schema for "${workspaceId}" (found ${shown}).`,
    `Expected "${WORKSPACE_STATE_SCHEMA_VERSION}".`,
    "Recreate this workspace with /api/workspace/new.",
  ].join(" ");
};
