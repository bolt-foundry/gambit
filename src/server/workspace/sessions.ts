import * as path from "@std/path";
import { createWorkspaceScaffold } from "../../workspace.ts";
import {
  resolveWorkspaceIdFromRecord,
  resolveWorkspaceIdFromSearchParams,
} from "../../workspace_routes.ts";
import type { GradingRunRecord, SessionMeta } from "../../server_types.ts";
import type { WorkspaceRecord } from "../../server_workspace_runtime.ts";
import type { SavedState } from "@bolt-foundry/gambit-core";

export const createWorkspaceSessionService = (deps: {
  sessionsRoot: string;
  workspaceRoot: string;
  workspaceScaffoldEnabled: boolean;
  activeWorkspaceOnboarding: boolean;
  workspaceStateSchemaVersion: string;
  getResolvedDeckPath: () => string;
  deckSlugFromPath: (deckPath: string) => string;
  randomId: (prefix: string) => string;
  registerWorkspace: (record: WorkspaceRecord) => WorkspaceRecord;
  resolveWorkspaceRecord: (
    workspaceId: string,
  ) => WorkspaceRecord | null | undefined;
  readSessionState: (workspaceId: string) => SavedState | undefined;
  persistSessionState: (state: SavedState) => SavedState;
}) => {
  const buildWorkspaceMeta = (
    record: { id: string; rootDir: string; rootDeckPath: string },
    base?: Record<string, unknown>,
  ): Record<string, unknown> => {
    const createdAt =
      typeof (base as { sessionCreatedAt?: unknown })?.sessionCreatedAt ===
          "string"
        ? (base as { sessionCreatedAt: string }).sessionCreatedAt
        : typeof (base as { workspaceCreatedAt?: unknown })
            ?.workspaceCreatedAt === "string"
        ? (base as { workspaceCreatedAt: string }).workspaceCreatedAt
        : new Date().toISOString();
    return {
      ...(base ?? {}),
      workspaceSchemaVersion: deps.workspaceStateSchemaVersion,
      workspaceId: record.id,
      workspaceRootDeckPath: record.rootDeckPath,
      workspaceRootDir: record.rootDir,
      workspaceCreatedAt: (base as { workspaceCreatedAt?: string } | undefined)
        ?.workspaceCreatedAt ?? createdAt,
      sessionCreatedAt: (base as { sessionCreatedAt?: string } | undefined)
        ?.sessionCreatedAt ?? createdAt,
      deck: record.rootDeckPath,
      deckSlug: deps.deckSlugFromPath(record.rootDeckPath),
      sessionId: record.id,
    };
  };

  const createWorkspaceSession = async (
    options?: { onboarding?: boolean },
  ): Promise<WorkspaceRecord> => {
    const createdAt = new Date().toISOString();
    if (deps.workspaceScaffoldEnabled) {
      const scaffold = await createWorkspaceScaffold({
        baseDir: deps.workspaceRoot,
      });
      const record = deps.registerWorkspace(scaffold);
      deps.persistSessionState({
        runId: record.id,
        messages: [],
        meta: buildWorkspaceMeta(record, {
          sessionCreatedAt: record.createdAt,
          workspaceCreatedAt: record.createdAt,
          workspaceOnboarding: options?.onboarding ?? false,
        }),
      });
      return record;
    }
    const workspaceId = deps.randomId("workspace");
    const rootDeckPath = deps.getResolvedDeckPath();
    const rootDir = path.dirname(rootDeckPath);
    const record = deps.registerWorkspace({
      id: workspaceId,
      rootDir,
      rootDeckPath,
      createdAt,
    });
    deps.persistSessionState({
      runId: record.id,
      messages: [],
      meta: buildWorkspaceMeta(record, {
        sessionCreatedAt: createdAt,
        workspaceCreatedAt: createdAt,
        workspaceOnboarding: options?.onboarding ?? false,
      }),
    });
    return record;
  };

  const ensureWorkspaceSession = (workspaceId: string): WorkspaceRecord => {
    const existingRecord = deps.resolveWorkspaceRecord(workspaceId);
    const createdAt = existingRecord?.createdAt ?? new Date().toISOString();
    const record = existingRecord ??
      deps.registerWorkspace({
        id: workspaceId,
        rootDir: path.dirname(deps.getResolvedDeckPath()),
        rootDeckPath: deps.getResolvedDeckPath(),
        createdAt,
      });
    const existingState = deps.readSessionState(workspaceId);
    if (!existingState) {
      deps.persistSessionState({
        runId: workspaceId,
        messages: [],
        meta: buildWorkspaceMeta(record, {
          sessionCreatedAt: createdAt,
          workspaceCreatedAt: createdAt,
          workspaceOnboarding: deps.activeWorkspaceOnboarding,
        }),
      });
    }
    return record;
  };

  const ensurePreconfiguredWorkspaceSession = (workspace?: {
    id?: string;
    rootDir?: string;
    rootDeckPath?: string;
  }) => {
    if (!workspace?.id || !workspace.rootDir || !workspace.rootDeckPath) return;
    const existing = deps.readSessionState(workspace.id);
    if (!existing) {
      deps.persistSessionState({
        runId: workspace.id,
        messages: [],
        meta: buildWorkspaceMeta(
          {
            id: workspace.id,
            rootDir: workspace.rootDir,
            rootDeckPath: workspace.rootDeckPath,
          },
          {
            sessionCreatedAt: new Date().toISOString(),
            workspaceCreatedAt: new Date().toISOString(),
            workspaceOnboarding: deps.activeWorkspaceOnboarding,
          },
        ),
      });
    }
  };

  const deleteSessionState = (sessionId: string): boolean => {
    if (
      !sessionId ||
      sessionId === "." ||
      sessionId === ".." ||
      sessionId !== path.basename(sessionId) ||
      sessionId.includes("/") ||
      sessionId.includes("\\")
    ) {
      return false;
    }
    const dir = path.resolve(deps.sessionsRoot, sessionId);
    if (dir === deps.sessionsRoot) return false;
    const relative = path.relative(deps.sessionsRoot, dir);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return false;
    }
    try {
      Deno.removeSync(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  };

  const buildSessionMeta = (
    sessionId: string,
    state?: SavedState,
  ): SessionMeta => {
    const meta = state?.meta ?? {};
    const createdAt = typeof meta.sessionCreatedAt === "string"
      ? meta.sessionCreatedAt
      : undefined;
    const deck = typeof meta.deck === "string" ? meta.deck : undefined;
    const deckSlug = typeof meta.deckSlug === "string"
      ? meta.deckSlug
      : undefined;
    const testBotName =
      typeof (meta as { testBotName?: unknown }).testBotName ===
          "string"
        ? (meta as { testBotName: string }).testBotName
        : undefined;
    const gradingRuns = Array.isArray(
        (meta as { gradingRuns?: unknown }).gradingRuns,
      )
      ? (meta as { gradingRuns: Array<GradingRunRecord> }).gradingRuns.map(
        (run) => ({
          id: typeof run.id === "string" ? run.id : deps.randomId("cal"),
          graderId: run.graderId,
          graderPath: run.graderPath,
          graderLabel: run.graderLabel,
          status: run.status,
          runAt: run.runAt,
          referenceSample: run.referenceSample,
          input: run.input,
          result: run.result,
          error: run.error,
        }),
      )
      : Array.isArray(meta.calibrationRuns)
      ? (meta.calibrationRuns as Array<GradingRunRecord>).map((run) => ({
        id: typeof run.id === "string" ? run.id : deps.randomId("cal"),
        graderId: run.graderId,
        graderPath: run.graderPath,
        graderLabel: run.graderLabel,
        status: run.status,
        runAt: run.runAt,
        referenceSample: run.referenceSample,
        input: run.input,
        result: run.result,
        error: run.error,
      }))
      : undefined;
    const sessionDir = typeof meta.sessionDir === "string"
      ? meta.sessionDir
      : path.join(deps.sessionsRoot, sessionId);
    const statePath = typeof (meta as { sessionStatePath?: string })
        .sessionStatePath === "string"
      ? (meta as { sessionStatePath?: string }).sessionStatePath
      : path.join(sessionDir, "state.json");
    return {
      id: sessionId,
      deck,
      deckSlug,
      createdAt,
      testBotName,
      gradingRuns,
      sessionDir,
      statePath,
    };
  };

  const listSessions = (): Array<SessionMeta> => {
    try {
      const entries: Array<SessionMeta> = [];
      for (const entry of Deno.readDirSync(deps.sessionsRoot)) {
        if (!entry.isDirectory) continue;
        const state = deps.readSessionState(entry.name);
        if (!state) continue;
        entries.push(buildSessionMeta(entry.name, state));
      }
      entries.sort((a, b) => {
        const aKey = a.createdAt ?? a.id;
        const bKey = b.createdAt ?? b.id;
        return bKey.localeCompare(aKey);
      });
      return entries;
    } catch {
      return [];
    }
  };

  const getWorkspaceIdFromQuery = (url: URL): string | undefined =>
    resolveWorkspaceIdFromSearchParams(url.searchParams);

  const getWorkspaceIdFromBody = (
    body: Record<string, unknown> | null | undefined,
  ): string | undefined => {
    if (!body || typeof body !== "object") return undefined;
    return resolveWorkspaceIdFromRecord(body);
  };

  return {
    buildWorkspaceMeta,
    createWorkspaceSession,
    ensureWorkspaceSession,
    ensurePreconfiguredWorkspaceSession,
    deleteSessionState,
    buildSessionMeta,
    listSessions,
    getWorkspaceIdFromQuery,
    getWorkspaceIdFromBody,
  };
};
