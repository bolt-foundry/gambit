import * as path from "@std/path";
import { assertSafeBuildBotRoot, randomId } from "./server_helpers.ts";
import { defaultSessionRoot } from "./cli_utils.ts";
import { makeConsoleTracer } from "./trace.ts";
import { loadDeck } from "@bolt-foundry/gambit-core";
import type {
  LoadedDeck,
  ModelProvider,
  SavedState,
} from "@bolt-foundry/gambit-core";
import { createSessionStore } from "./server_session_store.ts";
import {
  buildRootScenarioFallback,
  buildWorkspaceDeckStateFromLoadedDeck,
  resolveGraderDeckFromState,
  resolveScenarioDeckFromState,
  summarizeDeckState,
  toAvailableGraderDeck,
  toAvailableTestDeck,
  toDeckLabel,
} from "./server_workspace_decks.ts";
import { createWorkspaceDeckGraphqlOperations } from "./server_workspace_graphql.ts";
import { createWorkspaceRuntime } from "./server_workspace_runtime.ts";
import {
  createReadCodexWorkspaceStatus,
  handleBuildProviderStatusRequest,
  normalizeBuildChatProvider,
  persistBuildChatProviderMeta,
} from "./server_build_chat_provider.ts";
import {
  WORKSPACE_ROUTE_BASE,
  WORKSPACE_STATE_SCHEMA_VERSION,
  workspaceSchemaError,
} from "./workspace_routes.ts";
import { appendDurableStreamEvent } from "./durable_streams.ts";
import type { SchemaDescription, WorkspaceDeckState } from "./server_types.ts";
import { ensureSimulatorBundle } from "./server_simulator_ui.ts";
import { createSimulatorRequestHandler } from "./server/request_handler.ts";
import { createWorkspaceSessionService } from "./server/workspace/sessions.ts";
import { createWorkspaceReadModelService } from "./server/workspace/read_model.ts";
import {
  buildPersistedAssistantDeck,
  describeDeckInputSchemaFromPath,
  describeZodSchema,
  ensureGambitPolicyInBotRoot,
  GAMBIT_BOT_SOURCE_DECK_PATH,
  mapDeckTools,
  resolveDeckPath,
} from "./server/workspace/schema.ts";
import { createOpenResponsesEventPersistence } from "./server/workspace/response_events.ts";
import { createWorkspaceBuildService } from "./server/workspace/build.ts";
import { createWorkspaceScenarioService } from "./server/workspace/scenarios.ts";
import { createWorkspaceGradingService } from "./server/workspace/grading.ts";
import { createWorkspaceVerifyService } from "./server/workspace/verify.ts";
import { createWorkspaceConversationSessionService } from "./server/workspace/conversation_sessions.ts";

const logger = console;
const WORKSPACE_STREAM_ID = "gambit-workspace";
const TEST_STREAM_ID = "gambit-test";
const WORKSPACE_API_BASE = "/api/workspace";
const WORKSPACES_API_BASE = "/api/workspaces";
const VERIFY_SCENARIO_RUNS_MAX = 24;
const VERIFY_GRADER_REPEATS_MAX = 24;
const VERIFY_BATCH_CONCURRENCY_MAX = 6;
const DEFAULT_VERIFY_SCENARIO_RUNS = 10;
const DEFAULT_VERIFY_GRADER_REPEATS = 10;
const DEFAULT_VERIFY_CONCURRENCY = 4;
const WORKSPACE_REFRESH_DEBUG = (() => {
  const value = (Deno.env.get("GAMBIT_WORKSPACE_REFRESH_DEBUG") ?? "")
    .toLowerCase()
    .trim();
  return value === "1" || value === "true" || value === "yes";
})();

const logWorkspaceRefreshDebug = (
  event: string,
  payload: Record<string, unknown>,
): void => {
  if (!WORKSPACE_REFRESH_DEBUG) return;
  logger.info(
    `[gambit-workspace-refresh-debug] ${event} ${JSON.stringify(payload)}`,
  );
};

const extractMissingReadfilePath = (message: string): string | null => {
  const match = message.match(/readfile ['"]([^'"]+)['"]/);
  return match?.[1] ?? null;
};

const safeJsonStringify = (value: unknown): string => {
  const stack: Array<unknown> = [];
  return JSON.stringify(value, function (_key, candidate) {
    if (!candidate || typeof candidate !== "object") return candidate;
    while (stack.length > 0 && stack[stack.length - 1] !== this) {
      stack.pop();
    }
    if (stack.includes(candidate)) return "[Circular]";
    stack.push(candidate);
    return candidate;
  });
};

const sanitizeJsonRecord = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const parsed = JSON.parse(safeJsonStringify(value));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
};

export function startWebSocketSimulator(opts: {
  deckPath: string;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  initialContext?: unknown;
  contextProvided?: boolean;
  port?: number;
  verbose?: boolean;
  signal?: AbortSignal;
  sessionDir?: string;
  workspace?: {
    id: string;
    rootDeckPath: string;
    rootDir: string;
    onboarding?: boolean;
    scaffoldEnabled?: boolean;
    scaffoldRoot?: string;
  };
  autoBundle?: boolean;
  forceBundle?: boolean;
  sourceMap?: boolean;
  bundlePlatform?: "deno" | "browser";
  responsesMode?: boolean;
  workerSandbox?: boolean;
}): ReturnType<typeof Deno.serve> {
  const port = opts.port ?? 8000;
  const initialContext = opts.initialContext;
  const hasInitialContext = opts.contextProvided ??
    (initialContext !== undefined);
  const buildAssistantDeckPath = GAMBIT_BOT_SOURCE_DECK_PATH
    ? resolveDeckPath(GAMBIT_BOT_SOURCE_DECK_PATH)
    : resolveDeckPath(opts.deckPath);
  const consoleTracer = opts.verbose ? makeConsoleTracer() : undefined;
  let resolvedDeckPath = resolveDeckPath(opts.deckPath);
  const buildBotRootCache = new Map<string, string>();
  const activeWorkspaceId = opts.workspace?.id ?? null;
  const activeWorkspaceOnboarding = Boolean(opts.workspace?.onboarding);
  const workspaceScaffoldEnabled = Boolean(opts.workspace?.scaffoldEnabled);
  const workspaceScaffoldRoot = opts.workspace?.scaffoldRoot
    ? path.resolve(opts.workspace.scaffoldRoot)
    : null;
  const sessionsRoot = (() => {
    const base = opts.sessionDir
      ? path.resolve(opts.sessionDir)
      : defaultSessionRoot(resolvedDeckPath);
    try {
      Deno.mkdirSync(base, { recursive: true });
    } catch (err) {
      logger.warn(
        `[sim] unable to ensure workspace state directory ${base}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    return base;
  })();
  const workspaceRoot = (() => {
    const dir = workspaceScaffoldRoot ?? sessionsRoot;
    if (workspaceScaffoldEnabled) {
      try {
        Deno.mkdirSync(dir, { recursive: true });
      } catch (err) {
        logger.warn(
          `[sim] unable to ensure workspace directory ${dir}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    return dir;
  })();
  const deckSlugFromPath = (p: string) => {
    const baseName = path.basename(p || "deck");
    const withoutExt = baseName.replace(/\.[^.]+$/, "");
    const slug = withoutExt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
      /^-+|-+$/g,
      "",
    );
    return slug || "session";
  };

  const gambitBotSourceDir = GAMBIT_BOT_SOURCE_DECK_PATH
    ? path.dirname(GAMBIT_BOT_SOURCE_DECK_PATH)
    : "";

  const resolveBuildBotRoot = async (
    workspaceId?: string | null,
  ): Promise<string> => {
    const override = Deno.env.get("GAMBIT_SIMULATOR_BUILD_BOT_ROOT")?.trim();
    if (override) {
      const root = await Deno.realPath(override);
      const info = await Deno.stat(root);
      if (!info.isDirectory) {
        throw new Error(`Build bot root is not a directory: ${root}`);
      }
      assertSafeBuildBotRoot(root, gambitBotSourceDir);
      await ensureGambitPolicyInBotRoot(root);
      return root;
    }
    const cacheKey = workspaceId ?? "default";
    const cached = buildBotRootCache.get(cacheKey);
    if (cached) return cached;
    const record = resolveWorkspaceRecord(workspaceId ?? "");
    const candidate = record?.rootDir ?? path.dirname(resolvedDeckPath);
    const root = await Deno.realPath(candidate);
    const info = await Deno.stat(root);
    if (!info.isDirectory) {
      throw new Error(`Build bot root is not a directory: ${root}`);
    }
    assertSafeBuildBotRoot(root, gambitBotSourceDir);
    await ensureGambitPolicyInBotRoot(root);
    buildBotRootCache.set(cacheKey, root);
    return root;
  };

  const logWorkspaceBotRoot = async (
    endpoint: string,
    workspaceId?: string | null,
  ): Promise<void> => {
    try {
      const root = await resolveBuildBotRoot(workspaceId);
      logger.info(
        `[sim] ${endpoint}: workspaceId=${
          workspaceId ?? "(none)"
        } botRoot=${root}`,
      );
    } catch (err) {
      logger.warn(
        `[sim] ${endpoint}: workspaceId=${
          workspaceId ?? "(none)"
        } botRoot=<unresolved> ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  const resolveBuildBotPath = async (root: string, inputPath: string) => {
    if (!inputPath || typeof inputPath !== "string") {
      throw new Error("path is required");
    }
    const normalizedInput = path.normalize(inputPath);
    const segments = normalizedInput.split(/\\|\//g);
    if (segments.includes("..")) {
      throw new Error("path traversal is not allowed");
    }
    const candidate = path.isAbsolute(normalizedInput)
      ? normalizedInput
      : path.resolve(root, normalizedInput);
    const relativePath = path.relative(root, candidate);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("path escapes bot root");
    }
    const stat = await Deno.lstat(candidate);
    if (stat.isSymlink) {
      throw new Error("symlinks are not allowed");
    }
    const realCandidate = await Deno.realPath(candidate);
    const realRelative = path.relative(root, realCandidate);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("path escapes bot root");
    }
    return { fullPath: candidate, relativePath, stat };
  };

  const readPreviewText = (bytes: Uint8Array): string | null => {
    const limit = Math.min(bytes.length, 8192);
    for (let i = 0; i < limit; i += 1) {
      if (bytes[i] === 0) return null;
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      return decoder.decode(bytes);
    } catch {
      return null;
    }
  };

  let deckSlug = deckSlugFromPath(resolvedDeckPath);
  let deckLabel: string | undefined = undefined;
  let rootStartMode: "assistant" | "user" | undefined = undefined;

  const enrichStateWithSession = (state: SavedState): {
    state: SavedState;
    dir?: string;
  } => {
    const meta = { ...(state.meta ?? {}) };
    const now = new Date();
    meta.sessionUpdatedAt = now.toISOString();
    if (typeof meta.sessionId !== "string") {
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      meta.sessionId = `${deckSlug}-${stamp}`;
      meta.sessionCreatedAt = now.toISOString();
    }
    if (typeof meta.workspaceId !== "string") {
      meta.workspaceId = String(meta.sessionId);
    }
    if (typeof meta.workspaceSchemaVersion !== "string") {
      meta.workspaceSchemaVersion = WORKSPACE_STATE_SCHEMA_VERSION;
    }
    if (typeof meta.deck !== "string") {
      meta.deck = resolvedDeckPath;
    }
    if (typeof meta.deckSlug !== "string") {
      meta.deckSlug = deckSlug;
    }
    if (typeof meta.sessionDir !== "string") {
      meta.sessionDir = path.join(sessionsRoot, String(meta.sessionId));
    }
    if (
      typeof meta.sessionSqlitePath !== "string" &&
      typeof meta.sessionDir === "string"
    ) {
      meta.sessionSqlitePath = path.join(meta.sessionDir, "workspace.sqlite");
    }
    const dir = typeof meta.sessionDir === "string"
      ? meta.sessionDir
      : undefined;
    return { state: { ...state, meta }, dir };
  };

  const {
    selectCanonicalScenarioRunSummary,
    appendWorkspaceEnvelope,
    appendOpenResponsesRunEvent,
    appendSessionEvent,
    appendGradingLog,
    persistSessionState,
    readSessionStateStrict,
    readSessionState,
    readWorkspaceDeckState,
    readBuildState,
    listOpenResponsesRunEvents,
    listOpenResponsesOutputItems,
    subscribeOpenResponsesRunEvents,
    writeWorkspaceDeckState,
  } = createSessionStore({
    sessionsRoot,
    randomId,
    logger,
    enrichStateWithSession,
    workspaceStateSchemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
    workspaceSchemaError,
  });

  const resolvePreferredDeckPath = async (
    candidate: string,
  ): Promise<string> => {
    if (path.basename(candidate) === "PROMPT.md") return candidate;
    const promptPath = path.join(path.dirname(candidate), "PROMPT.md");
    try {
      const stat = await Deno.stat(promptPath);
      if (stat.isFile) return promptPath;
    } catch {
      // ignore missing PROMPT.md
    }
    return candidate;
  };

  const createDeckLoadPromise = (): Promise<LoadedDeck | null> =>
    resolvePreferredDeckPath(resolvedDeckPath)
      .then((preferredPath) => {
        resolvedDeckPath = preferredPath;
        return loadDeck(preferredPath);
      })
      .then((deck) => {
        resolvedDeckPath = deck.path;
        buildBotRootCache.clear();
        deckSlug = deckSlugFromPath(resolvedDeckPath);
        rootStartMode = deck.startMode === "assistant" ||
            deck.startMode === "user"
          ? deck.startMode
          : undefined;
        deckLabel = typeof deck.label === "string"
          ? deck.label
          : toDeckLabel(deck.path);
        const scenarioDecks = (deck.testDecks ?? []).map(toAvailableTestDeck);
        const graderDecks = (deck.graderDecks ?? []).map(toAvailableGraderDeck);
        logWorkspaceRefreshDebug("deck.reload.success", {
          resolvedDeckPath,
          ...summarizeDeckState({
            scenarioDecks,
            graderDecks,
          }),
        });
        return deck;
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logWorkspaceRefreshDebug("deck.reload.failure", {
          resolvedDeckPath,
          error: message,
          missingPath: extractMissingReadfilePath(message),
        });
        logger.warn(`[sim] failed to load deck: ${message}`);
        return null;
      });

  const createSchemaPromise = (
    loadPromise: Promise<LoadedDeck | null>,
  ): Promise<SchemaDescription> =>
    loadPromise
      .then((deck) => {
        if (!deck) {
          return { error: "Deck failed to load" };
        }
        const desc = describeZodSchema(deck.inputSchema);
        const tools = mapDeckTools(deck.actionDecks);
        const next = tools ? { ...desc, tools } : desc;
        if (hasInitialContext) {
          return { ...next, defaults: initialContext };
        }
        return next;
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[sim] failed to load deck schema: ${message}`);
        return { error: message };
      });

  let deckLoadPromise: Promise<LoadedDeck | null> = createDeckLoadPromise();
  let schemaPromise: Promise<SchemaDescription> = createSchemaPromise(
    deckLoadPromise,
  );

  const reloadPrimaryDeck = () => {
    deckLoadPromise = createDeckLoadPromise();
    schemaPromise = createSchemaPromise(deckLoadPromise);
  };

  const buildDeckStateForLoadedDeck = (
    workspaceId: string,
    deck: LoadedDeck,
  ) =>
    buildWorkspaceDeckStateFromLoadedDeck({
      workspaceId,
      deck,
      buildPersistedAssistantDeck,
      describeDeckInputSchemaFromPath: (deckPath) =>
        describeDeckInputSchemaFromPath(deckPath, logger),
    });

  const readPrimaryDeckState = async (): Promise<WorkspaceDeckState | null> => {
    const loadedDeck = await deckLoadPromise.catch(() => null);
    if (!loadedDeck) return null;
    return await buildDeckStateForLoadedDeck(
      activeWorkspaceId ?? "__gambit-primary__",
      loadedDeck,
    );
  };

  const {
    activateWorkspaceDeck,
    registerWorkspace,
    removeWorkspace,
    resolveWorkspaceRecord,
    stopAllWorkspaceFsWatchers,
    summarizeWorkspaceDeckState,
  } = createWorkspaceRuntime({
    verbose: opts.verbose ?? false,
    logger,
    randomId,
    resolveDeckPath,
    readSessionState,
    readWorkspaceDeckState,
    writeWorkspaceDeckState,
    buildWorkspaceDeckStateFromLoadedDeck: (args) =>
      buildDeckStateForLoadedDeck(args.workspaceId, args.deck),
    reloadPrimaryDeck,
    getDeckLoadPromise: () => deckLoadPromise,
    getResolvedDeckPath: () => resolvedDeckPath,
    setResolvedDeckPath: (nextPath) => {
      resolvedDeckPath = nextPath;
    },
    clearDefaultBuildBotRoot: () => {
      buildBotRootCache.delete("default");
    },
    logWorkspaceRefreshDebug,
    extractMissingReadfilePath,
    emitWorkspaceGraphRefresh: (args) => {
      appendDurableStreamEvent(WORKSPACE_STREAM_ID, {
        type: "workspaceGraphRefresh",
        workspaceId: args.workspaceId,
        reason: args.reason,
        paths: args.paths,
        kinds: args.kinds,
      });
    },
  });

  const readWorkspaceDeckStateStrict = (workspaceId: string) => {
    const deckState = readWorkspaceDeckState(workspaceId);
    if (deckState) return deckState;
    throw new Error(`Workspace ${workspaceId} deck state is unavailable`);
  };

  const workspaceDeckGraphqlOperations = createWorkspaceDeckGraphqlOperations({
    activateWorkspaceDeck,
    readWorkspaceDeckState,
    getResolvedDeckPath: () => resolvedDeckPath,
    summarizeWorkspaceDeckState,
    logWorkspaceRefreshDebug,
  });

  if (
    opts.workspace?.id && opts.workspace.rootDir && opts.workspace.rootDeckPath
  ) {
    registerWorkspace({
      id: opts.workspace.id,
      rootDir: opts.workspace.rootDir,
      rootDeckPath: opts.workspace.rootDeckPath,
      createdAt: new Date().toISOString(),
    });
  }

  const sessionService = createWorkspaceSessionService({
    sessionsRoot,
    workspaceRoot,
    workspaceScaffoldEnabled,
    activeWorkspaceOnboarding,
    workspaceStateSchemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
    getResolvedDeckPath: () => resolvedDeckPath,
    deckSlugFromPath,
    randomId,
    registerWorkspace,
    resolveWorkspaceRecord,
    readSessionState,
    persistSessionState,
  });
  sessionService.ensurePreconfiguredWorkspaceSession(opts.workspace);

  const openResponsesEventPersistence = createOpenResponsesEventPersistence({
    sanitizeJsonRecord,
    appendOpenResponsesRunEvent,
  });

  const readCodexWorkspaceStatus = createReadCodexWorkspaceStatus({
    resolveBuildBotRoot,
    resolveWorkspaceDeckPath: (workspaceId?: string | null) => {
      const record = workspaceId
        ? resolveWorkspaceRecord(workspaceId)
        : undefined;
      return record?.rootDeckPath ?? resolvedDeckPath;
    },
  });

  const wantsSourceMap = Boolean(opts.sourceMap);
  const bundlePlatform = opts.bundlePlatform ?? "deno";
  const autoBundle = opts.autoBundle ?? true;
  const forceBundle = opts.forceBundle ?? false;
  ensureSimulatorBundle({
    autoBundle,
    bundlePlatform,
    forceBundle,
    logger,
    verbose: opts.verbose,
    wantsSourceMap,
  });

  const buildService = createWorkspaceBuildService({
    buildAssistantDeckPath,
    initialContext,
    hasInitialContext,
    modelProvider: opts.modelProvider,
    model: opts.model,
    modelForce: opts.modelForce,
    responsesMode: opts.responsesMode,
    workerSandbox: opts.workerSandbox,
    randomId,
    readSessionState,
    readSessionStateStrict,
    readBuildState,
    appendWorkspaceEnvelope,
    appendDurableStreamEvent,
    workspaceStreamId: WORKSPACE_STREAM_ID,
    persistCanonicalUserInputEvent:
      openResponsesEventPersistence.persistCanonicalUserInputEvent,
    persistOpenResponsesTracesFromState:
      openResponsesEventPersistence.persistOpenResponsesTracesFromState,
    persistOpenResponsesTraceEvent:
      openResponsesEventPersistence.persistOpenResponsesTraceEvent,
  });

  const scenarioService = createWorkspaceScenarioService({
    modelProvider: opts.modelProvider,
    model: opts.model,
    modelForce: opts.modelForce,
    responsesMode: opts.responsesMode,
    workerSandbox: opts.workerSandbox,
    consoleTracer,
    logger,
    randomId,
    getResolvedDeckPath: () => resolvedDeckPath,
    getRootStartMode: () => rootStartMode,
    getSchemaPromise: () => schemaPromise,
    buildWorkspaceMeta: sessionService.buildWorkspaceMeta,
    selectCanonicalScenarioRunSummary,
    persistSessionState,
    appendSessionEvent,
    appendWorkspaceEnvelope: (state, _domain, payload) => {
      appendWorkspaceEnvelope(
        state,
        "test",
        payload as Record<string, unknown>,
      );
    },
    appendDurableStreamEvent,
    workspaceStreamId: WORKSPACE_STREAM_ID,
    testStreamId: TEST_STREAM_ID,
    persistOpenResponsesTraceEvent:
      openResponsesEventPersistence.persistOpenResponsesTraceEvent,
    persistCanonicalUserInputEvent:
      openResponsesEventPersistence.persistCanonicalUserInputEvent,
    persistCanonicalStateMessages:
      openResponsesEventPersistence.persistCanonicalStateMessages,
    readSessionState,
    readSessionStateStrict,
    activateWorkspaceDeck,
    resolveWorkspaceRecord,
    readWorkspaceDeckStateStrict,
    buildRootScenarioFallback,
    resolveScenarioDeckFromState,
  });

  const readModelService = createWorkspaceReadModelService({
    readSessionState,
    readSessionStateStrict,
    readWorkspaceBuildRunForGraphql:
      buildService.readWorkspaceBuildRunForGraphql,
    getLiveTestRunEntry: scenarioService.getLiveTestRunEntry,
    getLiveTestRunEntryByWorkspaceId:
      scenarioService.getLiveTestRunEntryByWorkspaceId,
    readPersistedTestRunStatusById:
      scenarioService.readPersistedTestRunStatusById,
    syncTestBotRunFromState: scenarioService.syncTestBotRunFromState,
    selectCanonicalScenarioRunSummary,
    activateWorkspaceDeck,
    readWorkspaceDeckState,
    resolveScenarioDeckFromState,
    listSessions: sessionService.listSessions,
  });

  const gradingService = createWorkspaceGradingService({
    randomId,
    modelProvider: opts.modelProvider,
    responsesMode: opts.responsesMode,
    workerSandbox: opts.workerSandbox,
    appendDurableStreamEvent,
    workspaceStreamId: WORKSPACE_STREAM_ID,
    activateWorkspaceDeck,
    readWorkspaceDeckStateStrict,
    resolveGraderDeckFromState,
    readSessionState,
    readSessionStateStrict,
    persistSessionState,
    appendGradingLog,
    readWorkspaceScenarioRunsForGraphql:
      scenarioService.readWorkspaceScenarioRunsForGraphql,
  });

  const verifyService = createWorkspaceVerifyService({
    randomId,
    verifyScenarioRunsMax: VERIFY_SCENARIO_RUNS_MAX,
    verifyGraderRepeatsMax: VERIFY_GRADER_REPEATS_MAX,
    verifyBatchConcurrencyMax: VERIFY_BATCH_CONCURRENCY_MAX,
    defaultVerifyScenarioRuns: DEFAULT_VERIFY_SCENARIO_RUNS,
    defaultVerifyGraderRepeats: DEFAULT_VERIFY_GRADER_REPEATS,
    defaultVerifyConcurrency: DEFAULT_VERIFY_CONCURRENCY,
    appendDurableStreamEvent,
    workspaceStreamId: WORKSPACE_STREAM_ID,
    activateWorkspaceDeck,
    readWorkspaceDeckStateStrict,
    resolveGraderDeckFromState,
    readSessionState,
    readSessionStateStrict,
    persistSessionState,
    appendGradingLog,
    startWorkspaceScenarioRunForGraphql:
      scenarioService.startWorkspaceScenarioRunForGraphql,
    readWorkspaceScenarioRunsForGraphql:
      scenarioService.readWorkspaceScenarioRunsForGraphql,
    getLiveTestRunEntry: scenarioService.getLiveTestRunEntry,
    createWorkspaceGradeRunForGraphql:
      gradingService.createWorkspaceGradeRunForGraphql,
  });

  const conversationSessions = createWorkspaceConversationSessionService({
    readWorkspaceBuildRunForGraphql:
      buildService.readWorkspaceBuildRunForGraphql,
    startWorkspaceBuildRun: buildService.startWorkspaceBuildRun,
    stopWorkspaceBuildRun: buildService.stopWorkspaceBuildRun,
    startWorkspaceScenarioRunForGraphql:
      scenarioService.startWorkspaceScenarioRunForGraphql,
    sendWorkspaceScenarioRunForGraphql:
      scenarioService.sendWorkspaceScenarioRunForGraphql,
    stopWorkspaceScenarioRunForGraphql:
      scenarioService.stopWorkspaceScenarioRunForGraphql,
    readWorkspaceScenarioRunsForGraphql:
      scenarioService.readWorkspaceScenarioRunsForGraphql,
    readWorkspaceGradeRunsForGraphql:
      gradingService.readWorkspaceGradeRunsForGraphql,
    createWorkspaceGradeRunForGraphql:
      gradingService.createWorkspaceGradeRunForGraphql,
    readWorkspaceVerifyBatchesForGraphql:
      verifyService.readWorkspaceVerifyBatchesForGraphql,
    createWorkspaceVerifyBatchRunForGraphql:
      verifyService.createWorkspaceVerifyBatchRunForGraphql,
    defaultVerifyScenarioRuns: DEFAULT_VERIFY_SCENARIO_RUNS,
    defaultVerifyGraderRepeats: DEFAULT_VERIFY_GRADER_REPEATS,
    defaultVerifyConcurrency: DEFAULT_VERIFY_CONCURRENCY,
  });

  const handler = createSimulatorRequestHandler({
    modelProvider: opts.modelProvider,
    activeWorkspaceId,
    activeWorkspaceOnboarding,
    workspaceApiBase: WORKSPACE_API_BASE,
    workspacesApiBase: WORKSPACES_API_BASE,
    workspaceStateSchemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
    maxFilePreviewBytes: 250_000,
    workspaceRouteBase: WORKSPACE_ROUTE_BASE,
    getResolvedDeckPath: () => resolvedDeckPath,
    getDeckLabel: () => deckLabel,
    safeJsonStringify,
    getWorkspaceIdFromQuery: sessionService.getWorkspaceIdFromQuery,
    getWorkspaceIdFromBody: sessionService.getWorkspaceIdFromBody,
    buildWorkspaceReadModel: readModelService.buildWorkspaceReadModel,
    listSessions: sessionService.listSessions,
    createWorkspaceSession: sessionService.createWorkspaceSession,
    ensureWorkspaceSession: sessionService.ensureWorkspaceSession,
    deleteSessionState: sessionService.deleteSessionState,
    deleteWorkspaceRuntime: (workspaceId: string) => {
      removeWorkspace(workspaceId);
    },
    logWorkspaceBotRoot,
    activateWorkspaceDeck,
    readPrimaryDeckState,
    readWorkspaceDeckStateStrict,
    resolveScenarioDeckFromState,
    readSessionState,
    readSessionStateStrict,
    persistSessionState,
    appendSessionEvent,
    isFeedbackEligibleMessageRef: scenarioService.isFeedbackEligibleMessageRef,
    isFeedbackEligiblePersistedTestRunMessageRef:
      scenarioService.isFeedbackEligiblePersistedTestRunMessageRef,
    randomId,
    syncTestBotRunFromState: scenarioService.syncTestBotRunFromState,
    broadcastTestBot: scenarioService.broadcastTestBot,
    getLiveTestRunEntry: scenarioService.getLiveTestRunEntry,
    startWorkspaceScenarioRunForGraphql:
      scenarioService.startWorkspaceScenarioRunForGraphql,
    sendWorkspaceScenarioRunForGraphql:
      scenarioService.sendWorkspaceScenarioRunForGraphql,
    saveWorkspaceFeedbackForGraphql: async (args) =>
      await scenarioService.saveWorkspaceFeedbackForGraphql(args),
    stopWorkspaceScenarioRunForGraphql:
      scenarioService.stopWorkspaceScenarioRunForGraphql,
    readWorkspaceScenarioRunsForGraphql:
      scenarioService.readWorkspaceScenarioRunsForGraphql,
    handleBuildProviderStatusRequest: (args) =>
      handleBuildProviderStatusRequest({
        ...args,
        readCodexWorkspaceStatus,
      }),
    readCodexWorkspaceStatus,
    normalizeBuildChatProvider,
    persistBuildChatProviderMeta,
    startWorkspaceBuildRun: buildService.startWorkspaceBuildRun,
    stopWorkspaceBuildRun: buildService.stopWorkspaceBuildRun,
    resetWorkspaceBuild: buildService.resetWorkspaceBuild,
    readWorkspaceBuildRunForGraphql:
      buildService.readWorkspaceBuildRunForGraphql,
    getLiveBuildRunEntry: buildService.getLiveBuildRunEntry,
    resolveBuildBotRoot,
    resolveBuildBotPath,
    readPreviewText,
    schemaPromise: () => schemaPromise,
    deckLoadPromise: () => deckLoadPromise,
    readWorkspaceOpenResponseEvents: listOpenResponsesRunEvents,
    readWorkspaceOpenResponseOutputItems: listOpenResponsesOutputItems,
    subscribeWorkspaceOpenResponseEvents: subscribeOpenResponsesRunEvents,
    readWorkspaceGradeRunsForGraphql:
      gradingService.readWorkspaceGradeRunsForGraphql,
    readWorkspaceGradingFlagsForGraphql:
      gradingService.readWorkspaceGradingFlagsForGraphql,
    createWorkspaceGradeRunForGraphql:
      gradingService.createWorkspaceGradeRunForGraphql,
    toggleWorkspaceGradeFlagForGraphql:
      gradingService.toggleWorkspaceGradeFlagForGraphql,
    updateWorkspaceGradeFlagReasonForGraphql:
      gradingService.updateWorkspaceGradeFlagReasonForGraphql,
    readWorkspaceVerifyBatchesForGraphql:
      verifyService.readWorkspaceVerifyBatchesForGraphql,
    createWorkspaceVerifyBatchRunForGraphql:
      verifyService.createWorkspaceVerifyBatchRunForGraphql,
    listWorkspaceConversationSessionsForGraphql:
      conversationSessions.listWorkspaceConversationSessionsForGraphql,
    readWorkspaceConversationSessionForGraphql:
      conversationSessions.readWorkspaceConversationSessionForGraphql,
    startWorkspaceConversationSessionForGraphql:
      conversationSessions.startWorkspaceConversationSessionForGraphql,
    sendWorkspaceConversationSessionForGraphql:
      conversationSessions.sendWorkspaceConversationSessionForGraphql,
    stopWorkspaceConversationSessionForGraphql:
      conversationSessions.stopWorkspaceConversationSessionForGraphql,
    workspaceDeckGraphqlOperations,
    toDeckLabel,
  });

  const server = Deno.serve(
    { port, signal: opts.signal, onListen: () => {} },
    handler,
  );

  const listenPort = (server.addr as Deno.NetAddr).port;
  logger.log(
    `Simulator listening on http://localhost:${listenPort} (deck=${resolvedDeckPath})`,
  );
  server.finished.finally(() => {
    stopAllWorkspaceFsWatchers();
  });
  return server;
}
