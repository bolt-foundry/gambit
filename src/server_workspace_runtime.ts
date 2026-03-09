import * as path from "@std/path";
import type { LoadedDeck, SavedState } from "@bolt-foundry/gambit-core";
import { summarizeDeckState } from "./server_workspace_decks.ts";
import type { WorkspaceDeckState } from "./server_types.ts";

export type WorkspaceRecord = {
  id: string;
  rootDir: string;
  rootDeckPath: string;
  createdAt: string;
};

type WorkspaceFsWatcher = {
  abortController: AbortController;
  pendingPaths: Set<string>;
  pendingKinds: Set<string>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  task: Promise<void>;
};

type WorkspaceRuntimeDeps = {
  verbose: boolean;
  logger: {
    info?: (...args: Array<unknown>) => void;
    warn: (...args: Array<unknown>) => void;
  };
  randomId: (prefix: string) => string;
  resolveDeckPath: (deckPath: string) => string;
  readSessionState: (workspaceId: string) => SavedState | undefined;
  readWorkspaceDeckState: (workspaceId: string) => WorkspaceDeckState | null;
  writeWorkspaceDeckState: (
    state: WorkspaceDeckState,
  ) => Promise<WorkspaceDeckState>;
  buildWorkspaceDeckStateFromLoadedDeck: (args: {
    workspaceId: string;
    deck: LoadedDeck;
  }) => Promise<WorkspaceDeckState>;
  reloadPrimaryDeck: () => void;
  getDeckLoadPromise: () => Promise<LoadedDeck | null>;
  getResolvedDeckPath: () => string;
  setResolvedDeckPath: (deckPath: string) => void;
  clearDefaultBuildBotRoot: () => void;
  logWorkspaceRefreshDebug: (
    event: string,
    payload: Record<string, unknown>,
  ) => void;
  extractMissingReadfilePath: (message: string) => string | null;
  emitWorkspaceGraphRefresh: (args: {
    workspaceId: string;
    reason: "fs-change";
    paths: Array<string>;
    kinds: Array<string>;
  }) => void;
};

export const createWorkspaceRuntime = (deps: WorkspaceRuntimeDeps) => {
  const workspaceById = new Map<string, WorkspaceRecord>();
  const workspaceFsWatchers = new Map<string, WorkspaceFsWatcher>();

  const normalizeWorkspaceFsPath = (value: string): string =>
    value.split(/\\|\//g).filter(Boolean).join("/");

  const isInternalWorkspacePath = (value: string): boolean => {
    const normalized = normalizeWorkspaceFsPath(value);
    return normalized === ".gambit" || normalized.startsWith(".gambit/");
  };

  const isWorkspaceGraphRelevantPath = (value: string): boolean => {
    const normalized = normalizeWorkspaceFsPath(value);
    if (normalized.length === 0) return false;
    if (isInternalWorkspacePath(normalized)) return false;
    return true;
  };

  const toWorkspaceRelativePath = (
    rootDir: string,
    absoluteOrRelativePath: string,
  ): string | null => {
    const resolvedRoot = path.resolve(rootDir);
    const resolvedCandidate = path.resolve(absoluteOrRelativePath);
    const relative = normalizeWorkspaceFsPath(
      path.relative(resolvedRoot, resolvedCandidate),
    );
    if (!relative || relative.startsWith("..")) return null;
    return relative;
  };

  const summarizeWorkspaceDeckState = (workspaceId?: string | null) =>
    summarizeDeckState(
      workspaceId ? deps.readWorkspaceDeckState(workspaceId) : null,
    );

  const buildDeckSourcePaths = (
    deckState: WorkspaceDeckState,
  ): Array<string> => {
    const candidates = [
      deckState.rootDeckPath,
      deckState.assistantDeck.deck,
      ...deckState.scenarioDecks.map((deck) => deck.path),
      ...deckState.graderDecks.map((deck) => deck.path),
    ];
    const resolved = new Set<string>();
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      resolved.add(path.resolve(trimmed));
    }
    return [...resolved];
  };

  const isWorkspaceDeckStateStale = async (args: {
    deckState: WorkspaceDeckState;
    nextPath: string;
  }): Promise<{ stale: boolean; reason: string | null }> => {
    const expectedRootDeckPath = path.resolve(args.nextPath);
    const persistedRootDeckPath = path.resolve(args.deckState.rootDeckPath);
    if (persistedRootDeckPath !== expectedRootDeckPath) {
      return { stale: true, reason: "root-deck-path-changed" };
    }
    const updatedAtMs = Date.parse(args.deckState.updatedAt);
    if (!Number.isFinite(updatedAtMs)) {
      return { stale: true, reason: "invalid-updated-at" };
    }
    for (const sourcePath of buildDeckSourcePaths(args.deckState)) {
      try {
        const info = await Deno.stat(sourcePath);
        if (!info.isFile) {
          return { stale: true, reason: "deck-source-not-file" };
        }
        const mtimeMs = info.mtime?.getTime();
        if (typeof mtimeMs === "number" && mtimeMs > updatedAtMs) {
          return { stale: true, reason: "deck-source-newer-than-state" };
        }
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          return { stale: true, reason: "deck-source-missing" };
        }
        return { stale: true, reason: "deck-source-stat-failed" };
      }
    }
    return { stale: false, reason: null };
  };

  const flushWorkspaceFsWatcher = (workspaceId: string) => {
    const watcher = workspaceFsWatchers.get(workspaceId);
    if (!watcher || watcher.pendingPaths.size === 0) return;
    const changedPaths = [...watcher.pendingPaths].sort();
    const kinds = [...watcher.pendingKinds].sort();
    deps.logWorkspaceRefreshDebug("fs.flush", {
      workspaceId,
      kinds,
      paths: changedPaths,
      pathCount: changedPaths.length,
    });
    watcher.pendingPaths.clear();
    watcher.pendingKinds.clear();
    watcher.debounceTimer = null;
    if (deps.verbose) {
      deps.logger.info?.(
        `[sim] workspace fs change detected workspaceId=${workspaceId} kinds=${
          kinds.join(",")
        } paths=${changedPaths.join(",")}`,
      );
    }
    const reloadAttemptId = deps.randomId("wsrefresh");
    deps.logWorkspaceRefreshDebug("fs.reload.start", {
      workspaceId,
      reloadAttemptId,
      changedPaths,
      kinds,
      resolvedDeckPath: deps.getResolvedDeckPath(),
      ...summarizeWorkspaceDeckState(workspaceId),
    });
    void activateWorkspaceDeck(workspaceId, {
      forceReload: true,
      source: "fs-watcher",
      reloadAttemptId,
    })
      .then(() => {
        deps.logWorkspaceRefreshDebug("fs.reload.success", {
          workspaceId,
          reloadAttemptId,
          changedPaths,
          kinds,
          resolvedDeckPath: deps.getResolvedDeckPath(),
          ...summarizeWorkspaceDeckState(workspaceId),
        });
        deps.emitWorkspaceGraphRefresh({
          workspaceId,
          reason: "fs-change",
          paths: changedPaths,
          kinds,
        });
        deps.logWorkspaceRefreshDebug("fs.graphRefresh.emit", {
          workspaceId,
          reloadAttemptId,
          reason: "fs-change",
          pathCount: changedPaths.length,
          kindCount: kinds.length,
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        deps.logWorkspaceRefreshDebug("fs.reload.fail", {
          workspaceId,
          reloadAttemptId,
          resolvedDeckPath: deps.getResolvedDeckPath(),
          error: message,
          missingPath: deps.extractMissingReadfilePath(message),
          ...summarizeWorkspaceDeckState(workspaceId),
        });
        deps.logger.warn(
          `[sim] workspace deck reload failed after fs change workspaceId=${workspaceId} error=${message}`,
        );
      });
  };

  const stopWorkspaceFsWatcher = (workspaceId: string) => {
    const watcher = workspaceFsWatchers.get(workspaceId);
    if (!watcher) return;
    deps.logWorkspaceRefreshDebug("fs.stop", { workspaceId });
    if (watcher.debounceTimer !== null) {
      clearTimeout(watcher.debounceTimer);
      watcher.debounceTimer = null;
    }
    watcher.abortController.abort();
    workspaceFsWatchers.delete(workspaceId);
  };

  const startWorkspaceFsWatcher = (record: {
    id: string;
    rootDir: string;
  }) => {
    if (workspaceFsWatchers.has(record.id)) return;
    deps.logWorkspaceRefreshDebug("fs.start", {
      workspaceId: record.id,
      rootDir: record.rootDir,
    });
    const abortController = new AbortController();
    const pendingPaths = new Set<string>();
    const pendingKinds = new Set<string>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const watcher = Deno.watchFs(record.rootDir, { recursive: true });
    abortController.signal.addEventListener("abort", () => {
      try {
        watcher.close();
      } catch {
        // ignore close errors while shutting down
      }
    });
    const task = (async () => {
      try {
        for await (const event of watcher) {
          if (abortController.signal.aborted) break;
          const kind = typeof event.kind === "string" ? event.kind : "unknown";
          let sawRelevantPath = false;
          for (const candidatePath of event.paths) {
            const relativePath = toWorkspaceRelativePath(
              record.rootDir,
              candidatePath,
            );
            if (!relativePath || !isWorkspaceGraphRelevantPath(relativePath)) {
              continue;
            }
            pendingPaths.add(relativePath);
            sawRelevantPath = true;
          }
          if (!sawRelevantPath) continue;
          pendingKinds.add(kind);
          if (debounceTimer !== null) continue;
          debounceTimer = setTimeout(() => {
            const existing = workspaceFsWatchers.get(record.id);
            if (!existing) return;
            existing.debounceTimer = null;
            flushWorkspaceFsWatcher(record.id);
          }, 120);
          const existing = workspaceFsWatchers.get(record.id);
          if (existing) {
            existing.debounceTimer = debounceTimer;
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          deps.logger.warn(
            `[sim] workspace fs watcher stopped for ${record.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      } finally {
        if (abortController.signal.aborted) {
          const existing = workspaceFsWatchers.get(record.id);
          if (existing && existing.debounceTimer !== null) {
            clearTimeout(existing.debounceTimer);
            existing.debounceTimer = null;
          }
        }
      }
    })();
    workspaceFsWatchers.set(record.id, {
      abortController,
      pendingPaths,
      pendingKinds,
      debounceTimer,
      task,
    });
  };

  const registerWorkspace = (record: WorkspaceRecord): WorkspaceRecord => {
    workspaceById.set(record.id, record);
    startWorkspaceFsWatcher(record);
    return record;
  };

  const resolveWorkspaceRecord = (
    workspaceId?: string | null,
  ): WorkspaceRecord | null => {
    if (!workspaceId) return null;
    const cached = workspaceById.get(workspaceId);
    if (cached) return cached;
    const state = deps.readSessionState(workspaceId);
    const meta = state?.meta ?? {};
    const deckPath = typeof (meta as { workspaceRootDeckPath?: unknown })
        .workspaceRootDeckPath === "string"
      ? (meta as { workspaceRootDeckPath: string }).workspaceRootDeckPath
      : typeof meta.deck === "string"
      ? meta.deck
      : undefined;
    const rootDir =
      typeof (meta as { workspaceRootDir?: unknown }).workspaceRootDir ===
          "string"
        ? (meta as { workspaceRootDir: string }).workspaceRootDir
        : deckPath
        ? path.dirname(deckPath)
        : undefined;
    if (!deckPath || !rootDir) return null;
    const createdAt =
      typeof (meta as { workspaceCreatedAt?: unknown }).workspaceCreatedAt ===
          "string"
        ? (meta as { workspaceCreatedAt: string }).workspaceCreatedAt
        : typeof meta.sessionCreatedAt === "string"
        ? meta.sessionCreatedAt
        : new Date().toISOString();
    return registerWorkspace({
      id: workspaceId,
      rootDir,
      rootDeckPath: deckPath,
      createdAt,
    });
  };

  const activateWorkspaceDeck = async (
    workspaceId?: string | null,
    options?: {
      forceReload?: boolean;
      source?: string;
      reloadAttemptId?: string;
    },
  ) => {
    if (!workspaceId) return;
    const record = resolveWorkspaceRecord(workspaceId);
    if (!record) return;
    const existingDeckState = deps.readWorkspaceDeckState(workspaceId);
    const source = options?.source ?? "unspecified";
    const reloadAttemptId = options?.reloadAttemptId ?? null;
    const nextPath = deps.resolveDeckPath(record.rootDeckPath);
    const resolvedDeckPath = deps.getResolvedDeckPath();
    const shouldSwitch = nextPath !== resolvedDeckPath;
    deps.logWorkspaceRefreshDebug("deck.activate.begin", {
      workspaceId,
      source,
      reloadAttemptId,
      forceReload: Boolean(options?.forceReload),
      nextPath,
      resolvedDeckPath,
      ...summarizeDeckState(existingDeckState),
    });
    if (shouldSwitch) {
      deps.setResolvedDeckPath(nextPath);
      deps.clearDefaultBuildBotRoot();
    } else if (!options?.forceReload && existingDeckState) {
      const freshness = await isWorkspaceDeckStateStale({
        deckState: existingDeckState,
        nextPath,
      });
      if (!freshness.stale) {
        deps.logWorkspaceRefreshDebug("deck.activate.skip", {
          workspaceId,
          source,
          reloadAttemptId,
          reason: "already-active-and-fresh",
          resolvedDeckPath,
          ...summarizeDeckState(existingDeckState),
        });
        return;
      }
      deps.logWorkspaceRefreshDebug("deck.activate.reload", {
        workspaceId,
        source,
        reloadAttemptId,
        reason: freshness.reason ?? "deck-state-stale",
        resolvedDeckPath,
        ...summarizeDeckState(existingDeckState),
      });
    }
    deps.reloadPrimaryDeck();
    const loadedDeck = await deps.getDeckLoadPromise().catch(() => null);
    let nextDeckState = existingDeckState;
    if (loadedDeck) {
      nextDeckState = await deps.buildWorkspaceDeckStateFromLoadedDeck({
        workspaceId,
        deck: loadedDeck,
      });
      await deps.writeWorkspaceDeckState(nextDeckState);
    }
    deps.logWorkspaceRefreshDebug("deck.activate.done", {
      workspaceId,
      source,
      reloadAttemptId,
      loaded: Boolean(loadedDeck),
      loadedDeckPath: loadedDeck?.path ?? null,
      resolvedDeckPath: deps.getResolvedDeckPath(),
      ...summarizeDeckState(nextDeckState),
    });
  };

  const removeWorkspace = (workspaceId: string) => {
    stopWorkspaceFsWatcher(workspaceId);
    workspaceById.delete(workspaceId);
  };

  const stopAllWorkspaceFsWatchers = () => {
    for (const workspaceId of workspaceFsWatchers.keys()) {
      stopWorkspaceFsWatcher(workspaceId);
    }
  };

  return {
    activateWorkspaceDeck,
    registerWorkspace,
    removeWorkspace,
    resolveWorkspaceRecord,
    stopAllWorkspaceFsWatchers,
    summarizeWorkspaceDeckState,
  };
};
