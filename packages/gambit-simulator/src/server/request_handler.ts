import * as path from "@std/path";
import type {
  FeedbackEntry,
  LoadedDeck,
  ModelProvider,
  OpenResponsesRunEventV0,
  SavedState,
} from "@bolt-foundry/gambit-core";
import type { SimulatorGraphqlOperations } from "../server_isograph_environment.ts";
import type { BuildChatProvider } from "../server_build_chat_provider.ts";
import type {
  GradingFlag,
  SchemaDescription,
  SessionMeta,
  WorkspaceDeckState,
} from "../server_types.ts";
import type { OpenResponsesOutputItemV0 } from "../server_session_store.ts";
import type {
  BuildBotRunStatus,
  TestBotRunEntry,
  TestBotRunStatus,
  WorkspaceConversationSessionKindForGraphql,
  WorkspaceConversationSessionRecordForGraphql,
  WorkspaceGradeRunForGraphql,
  WorkspaceVerifyBatchRecordForGraphql,
} from "./workspace/types.ts";
import { asGambitID } from "@bolt-foundry/gambit/src/gambit_id.ts";
import {
  asGambitWorkspaceRelativePath,
  type GambitWorkspaceRelativePath,
} from "@bolt-foundry/gambit/src/gambit_path.ts";
import { asGambitISODateTime } from "@bolt-foundry/gambit/src/gambit_time.ts";
import { handleLegacyApiRoutes } from "../server_legacy_api_routes.ts";
import { handleGraphqlStreamMultiplexRequest } from "../graphql_stream_multiplex.ts";
import { handleGraphqlSubscriptionStreamRequest } from "../graphql_subscription_stream.ts";
import {
  GRAPHQL_STREAMS_PREFIX,
  handleDurableStreamRequest,
} from "@bolt-foundry/gambit/src/durable_streams.ts";
import { gambitYoga } from "../simulator_graphql.ts";
import { handleOpenResponsesRequest } from "../server_openresponses.ts";
import {
  canServeReactBundle,
  handleSimulatorFaviconRequest,
  handleSimulatorPathRedirect,
  readReactBundle,
  readReactBundleSourceMap,
  shouldAdvertiseSourceMap,
  simulatorReactHtml,
} from "../server_simulator_ui.ts";
import { handleUiRoutes } from "../server_ui_routes.ts";

type WorkspaceFileReadRecord = {
  id: ReturnType<typeof asGambitID>;
  path: GambitWorkspaceRelativePath;
  size: number | null;
  modifiedAt: ReturnType<typeof asGambitISODateTime> | null;
  content: string | null;
};

type ReadWorkspaceFilesArgs = {
  workspaceId: string;
  id?: string | null;
  pathPrefix?: GambitWorkspaceRelativePath | null;
};

type ReadWorkspaceFiles = (
  args: ReadWorkspaceFilesArgs,
) => Promise<Array<WorkspaceFileReadRecord>>;

type GraphqlConversationSessionRecord =
  & WorkspaceConversationSessionRecordForGraphql
  & {
    scenarioRun?: TestBotRunStatus & { workspaceId: string };
  };

export const createSimulatorRequestHandler = (deps: {
  modelProvider: ModelProvider;
  activeWorkspaceId: string | null;
  activeWorkspaceOnboarding: boolean;
  workspaceApiBase: string;
  workspacesApiBase: string;
  workspaceStateSchemaVersion: string;
  maxFilePreviewBytes: number;
  workspaceRouteBase: string;
  getResolvedDeckPath: () => string;
  getDeckLabel: () => string | undefined;
  safeJsonStringify: (value: unknown) => string;
  getWorkspaceIdFromQuery: (url: URL) => string | undefined;
  getWorkspaceIdFromBody: (
    body: Record<string, unknown> | null | undefined,
  ) => string | undefined;
  buildWorkspaceReadModel: (workspaceId: string, options?: {
    requestedTestDeckPath?: string | null;
    requestedTestRunId?: string | null;
    requestedGradeRunId?: string | null;
  }) => Promise<unknown>;
  listSessions: () => Array<SessionMeta>;
  createWorkspaceSession: (
    options?: { onboarding?: boolean },
  ) => Promise<
    { id: string; rootDir: string; rootDeckPath: string; createdAt: string }
  >;
  ensureWorkspaceSession: (workspaceId: string) => {
    id: string;
    rootDir: string;
    rootDeckPath: string;
    createdAt: string;
  };
  deleteSessionState: (sessionId: string) => boolean;
  deleteWorkspaceRuntime: (workspaceId: string) => void;
  logWorkspaceBotRoot: (
    endpoint: string,
    workspaceId?: string | null,
  ) => Promise<void>;
  activateWorkspaceDeck: (
    workspaceId?: string | null,
    options?: {
      forceReload?: boolean;
      source?: string;
      reloadAttemptId?: string;
    },
  ) => Promise<void>;
  readPrimaryDeckState: () => Promise<WorkspaceDeckState | null>;
  readWorkspaceDeckStateStrict: (workspaceId: string) => WorkspaceDeckState;
  resolveScenarioDeckFromState: (
    deckState: WorkspaceDeckState,
    identifier: string,
  ) => WorkspaceDeckState["scenarioDecks"][number] | undefined;
  readSessionState: (workspaceId: string) => SavedState | undefined;
  readSessionStateStrict: (
    workspaceId: string,
    options?: { withTraces?: boolean },
  ) => SavedState | undefined;
  persistSessionState: (state: SavedState) => SavedState;
  appendSessionEvent: (
    state: SavedState,
    event: Record<string, unknown>,
  ) => void;
  isFeedbackEligibleMessageRef: (
    state: SavedState,
    messageRefId: string,
  ) => boolean;
  isFeedbackEligiblePersistedTestRunMessageRef: (
    state: SavedState,
    runId: string,
    messageRefId: string,
  ) => boolean;
  randomId: (prefix: string) => string;
  syncTestBotRunFromState: (run: TestBotRunStatus, state: SavedState) => void;
  broadcastTestBot: (
    payload: { type: "testBotStatus"; run: TestBotRunStatus },
    workspaceId: string,
  ) => void;
  getLiveTestRunEntry: (runId: string) => TestBotRunEntry | undefined;
  startWorkspaceScenarioRunForGraphql: (args: {
    runId?: string;
    workspaceId: string;
    scenarioDeckId?: string | null;
    scenarioInput?: unknown;
    assistantInit?: unknown;
  }) => Promise<TestBotRunStatus>;
  sendWorkspaceScenarioRunForGraphql: (args: {
    workspaceId: string;
    runId: string;
    message: string;
  }) => Promise<TestBotRunStatus>;
  saveWorkspaceFeedbackForGraphql: (args: {
    workspaceId: string;
    runId?: string | null;
    messageRefId: string;
    score: number | null;
    reason?: string | null;
  }) => Promise<{
    feedback?: FeedbackEntry;
    deleted: boolean;
    run: TestBotRunStatus;
  }>;
  stopWorkspaceScenarioRunForGraphql: (args: {
    workspaceId: string;
    runId: string;
  }) => Promise<TestBotRunStatus>;
  readWorkspaceScenarioRunsForGraphql: (
    workspaceId: string,
  ) => Array<TestBotRunStatus>;
  handleBuildProviderStatusRequest: (args: {
    req: Request;
    url: URL;
    isLegacyCodexTrustEndpoint: boolean;
    getWorkspaceIdFromQuery: (url: URL) => string | undefined;
    logWorkspaceBotRoot: (
      endpoint: string,
      workspaceId?: string | null,
    ) => Promise<void>;
    readCodexWorkspaceStatus: (
      workspaceId?: string | null,
      checkOnline?: boolean,
    ) => Promise<unknown>;
  }) => Promise<Response>;
  readCodexWorkspaceStatus: (
    workspaceId?: string | null,
    checkOnline?: boolean,
  ) => Promise<unknown>;
  normalizeBuildChatProvider: (value: unknown) => BuildChatProvider | null;
  persistBuildChatProviderMeta: (
    state: SavedState,
    workspaceId: string,
    buildChatProvider: BuildChatProvider,
  ) => SavedState;
  startWorkspaceBuildRun: (args: {
    workspaceId: string;
    message: string;
    buildChatProvider?: BuildChatProvider;
  }) => BuildBotRunStatus;
  stopWorkspaceBuildRun: (args: {
    workspaceId: string;
    runId: string;
  }) => Promise<BuildBotRunStatus>;
  resetWorkspaceBuild: (workspaceId: string) => Promise<BuildBotRunStatus>;
  readWorkspaceBuildRunForGraphql: (workspaceId: string) => BuildBotRunStatus;
  getLiveBuildRunEntry: (
    workspaceId: string,
  ) => { run: BuildBotRunStatus; promise: Promise<void> | null } | undefined;
  resolveBuildBotRoot: (workspaceId?: string | null) => Promise<string>;
  resolveBuildBotPath: (
    root: string,
    inputPath: string,
  ) => Promise<{
    fullPath: string;
    relativePath: string;
    stat: Deno.FileInfo;
  }>;
  readPreviewText: (bytes: Uint8Array) => string | null;
  schemaPromise: () => Promise<SchemaDescription>;
  deckLoadPromise: () => Promise<LoadedDeck | null>;
  readWorkspaceOpenResponseEvents: (args: {
    workspaceId: string;
    runId: string;
    fromSequence?: number;
  }) => Array<OpenResponsesRunEventV0>;
  readWorkspaceOpenResponseOutputItems: (args: {
    workspaceId: string;
    runId: string;
  }) => Array<OpenResponsesOutputItemV0>;
  subscribeWorkspaceOpenResponseEvents: (args: {
    workspaceId: string;
    runId: string;
    fromSequence?: number;
    signal?: AbortSignal;
  }) => AsyncIterable<OpenResponsesRunEventV0>;
  readWorkspaceGradeRunsForGraphql: (
    workspaceId: string,
  ) => Array<WorkspaceGradeRunForGraphql>;
  readWorkspaceGradingFlagsForGraphql: (
    workspaceId: string,
  ) => Array<GradingFlag>;
  createWorkspaceGradeRunForGraphql: (args: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: string | null;
  }) => Promise<WorkspaceGradeRunForGraphql>;
  toggleWorkspaceGradeFlagForGraphql: (args: {
    workspaceId: string;
    refId: string;
    runId: string;
    turnIndex?: number | null;
  }) => Promise<Array<GradingFlag>>;
  updateWorkspaceGradeFlagReasonForGraphql: (args: {
    workspaceId: string;
    refId: string;
    reason: string;
  }) => Promise<Array<GradingFlag>>;
  readWorkspaceVerifyBatchesForGraphql: (
    workspaceId: string,
  ) => Array<WorkspaceVerifyBatchRecordForGraphql>;
  createWorkspaceVerifyBatchRunForGraphql: (args: {
    workspaceId: string;
    scenarioDeckId?: string | null;
    graderId: string;
    scenarioRuns: number;
    graderRepeatsPerScenario: number;
    concurrency: number;
  }) => Promise<WorkspaceVerifyBatchRecordForGraphql>;
  listWorkspaceConversationSessionsForGraphql: (args: {
    workspaceId: string;
    kind?: WorkspaceConversationSessionKindForGraphql | null;
  }) => Promise<Array<WorkspaceConversationSessionRecordForGraphql>>;
  readWorkspaceConversationSessionForGraphql: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKindForGraphql;
    sessionId: string;
  }) => Promise<WorkspaceConversationSessionRecordForGraphql | null>;
  startWorkspaceConversationSessionForGraphql: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKindForGraphql;
    sessionId?: string | null;
    message?: string | null;
    scenarioDeckId?: string | null;
    scenarioInput?: unknown;
    assistantInit?: unknown;
    graderId?: string | null;
    scenarioRunId?: string | null;
    scenarioRuns?: number | null;
    graderRepeatsPerScenario?: number | null;
    concurrency?: number | null;
  }) => Promise<WorkspaceConversationSessionRecordForGraphql>;
  sendWorkspaceConversationSessionForGraphql: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKindForGraphql;
    sessionId: string;
    message: string;
  }) => Promise<WorkspaceConversationSessionRecordForGraphql>;
  stopWorkspaceConversationSessionForGraphql: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKindForGraphql;
    sessionId: string;
  }) => Promise<WorkspaceConversationSessionRecordForGraphql>;
  workspaceDeckGraphqlOperations: Pick<
    SimulatorGraphqlOperations,
    | "listWorkspaceGraderDecks"
    | "listWorkspaceScenarioDecks"
    | "readWorkspaceAssistantDeck"
  >;
  toDeckLabel: (value: string) => string;
}) =>
async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  const asScenarioRunRecord = (
    workspaceId: string,
    run: TestBotRunStatus,
  ): TestBotRunStatus & { workspaceId: string } => ({
    ...run,
    workspaceId,
  });

  const asConversationSessionRecord = (
    workspaceId: string,
    session: WorkspaceConversationSessionRecordForGraphql,
  ): GraphqlConversationSessionRecord => ({
    ...session,
    workspaceId,
    scenarioRun: session.scenarioRun
      ? asScenarioRunRecord(workspaceId, session.scenarioRun)
      : undefined,
  });

  const readWorkspaceFiles: ReadWorkspaceFiles = async (args) => {
    const root = await deps.resolveBuildBotRoot(args.workspaceId);
    const fileId = typeof args.id === "string" ? args.id.trim() : "";
    const pathPrefix = typeof args.pathPrefix === "string"
      ? args.pathPrefix.trim()
      : "";

    const normalizeRelativePath = (value: string) =>
      value.split(/\\|\//g).filter(Boolean).join("/");
    const isInternalWorkspacePath = (value: string): boolean => {
      const normalized = normalizeRelativePath(value);
      return normalized === ".gambit" ||
        normalized.startsWith(".gambit/");
    };

    const readTextContent = async (
      fullPath: string,
    ): Promise<string | null> => {
      try {
        return await Deno.readTextFile(fullPath);
      } catch {
        return null;
      }
    };

    const toRecord = async (
      fullPath: string,
      relPath: string,
      stat: Deno.FileInfo,
    ): Promise<WorkspaceFileReadRecord> => {
      const normalizedPath = normalizeRelativePath(relPath);
      return {
        id: asGambitID(
          `workspace-file:${args.workspaceId}:${normalizedPath}`,
        ),
        path: asGambitWorkspaceRelativePath(normalizedPath),
        size: typeof stat.size === "number" ? stat.size : null,
        modifiedAt: stat.mtime
          ? asGambitISODateTime(stat.mtime.toISOString())
          : null,
        content: await readTextContent(fullPath),
      };
    };

    if (fileId.length > 0) {
      try {
        const idPrefix = `workspace-file:${args.workspaceId}:`;
        if (!fileId.startsWith(idPrefix)) return [];
        const idPath = fileId.slice(idPrefix.length);
        if (idPath.length === 0) return [];
        const resolved = await deps.resolveBuildBotPath(root, idPath);
        if (!resolved.stat.isFile) return [];
        if (isInternalWorkspacePath(resolved.relativePath)) return [];
        return [
          await toRecord(
            resolved.fullPath,
            resolved.relativePath,
            resolved.stat,
          ),
        ];
      } catch {
        return [];
      }
    }

    const records: Array<WorkspaceFileReadRecord> = [];
    const pending: Array<string> = [root];

    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      for await (const entry of Deno.readDir(current)) {
        const fullPath = path.join(current, entry.name);
        let stat: Deno.FileInfo;
        try {
          stat = await Deno.lstat(fullPath);
        } catch {
          continue;
        }
        if (stat.isSymlink) continue;
        if (stat.isDirectory) {
          pending.push(fullPath);
          continue;
        }
        if (!stat.isFile) continue;
        const relativePath = normalizeRelativePath(
          path.relative(root, fullPath),
        );
        if (relativePath.length === 0) continue;
        if (isInternalWorkspacePath(relativePath)) continue;
        if (
          pathPrefix.length > 0 &&
          !relativePath.startsWith(normalizeRelativePath(pathPrefix))
        ) {
          continue;
        }
        records.push(await toRecord(fullPath, relativePath, stat));
      }
    }

    records.sort((a, b) => a.path.localeCompare(b.path));
    return records;
  };

  if (url.pathname === deps.workspacesApiBase) {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response(JSON.stringify({ workspaces: deps.listSessions() }), {
      headers: { "content-type": "application/json" },
    });
  }
  const workspaceTestRunGetMatch = url.pathname.match(
    new RegExp(`^${deps.workspacesApiBase}/([^/]+)/test/([^/]+)$`),
  );
  if (workspaceTestRunGetMatch) {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    try {
      const workspaceId = decodeURIComponent(workspaceTestRunGetMatch[1]);
      const requestedTestRunId = decodeURIComponent(
        workspaceTestRunGetMatch[2],
      );
      await deps.logWorkspaceBotRoot(
        `${deps.workspacesApiBase}/:id/test/:runId`,
        workspaceId,
      );
      await deps.activateWorkspaceDeck(workspaceId);
      const payload = await deps.buildWorkspaceReadModel(workspaceId, {
        requestedTestDeckPath: url.searchParams.get("deckPath"),
        requestedTestRunId,
      });
      if ("error" in (payload as Record<string, unknown>)) {
        const record = payload as { error: string; status: number };
        return new Response(JSON.stringify({ error: record.error }), {
          status: record.status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(deps.safeJsonStringify(payload), {
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
  }
  const workspaceGradeRunGetMatch = url.pathname.match(
    new RegExp(`^${deps.workspacesApiBase}/([^/]+)/grade/([^/]+)$`),
  );
  if (workspaceGradeRunGetMatch) {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    try {
      const workspaceId = decodeURIComponent(workspaceGradeRunGetMatch[1]);
      const requestedGradeRunId = decodeURIComponent(
        workspaceGradeRunGetMatch[2],
      );
      await deps.logWorkspaceBotRoot(
        `${deps.workspacesApiBase}/:id/grade/:runId`,
        workspaceId,
      );
      await deps.activateWorkspaceDeck(workspaceId);
      const payload = await deps.buildWorkspaceReadModel(workspaceId, {
        requestedTestDeckPath: url.searchParams.get("deckPath"),
        requestedGradeRunId,
      });
      if ("error" in (payload as Record<string, unknown>)) {
        const record = payload as { error: string; status: number };
        return new Response(JSON.stringify({ error: record.error }), {
          status: record.status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(deps.safeJsonStringify(payload), {
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
  }
  const workspaceGetMatch = url.pathname.match(
    new RegExp(`^${deps.workspacesApiBase}/([^/]+)$`),
  );
  if (workspaceGetMatch) {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    try {
      const workspaceId = decodeURIComponent(workspaceGetMatch[1]);
      await deps.logWorkspaceBotRoot(
        `${deps.workspacesApiBase}/:id`,
        workspaceId,
      );
      await deps.activateWorkspaceDeck(workspaceId);
      const payload = await deps.buildWorkspaceReadModel(workspaceId, {
        requestedTestDeckPath: url.searchParams.get("deckPath"),
      });
      if ("error" in (payload as Record<string, unknown>)) {
        const record = payload as { error: string; status: number };
        return new Response(JSON.stringify({ error: record.error }), {
          status: record.status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(deps.safeJsonStringify(payload), {
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
  }

  const legacyApiResponse = await handleLegacyApiRoutes({
    req,
    url,
    getWorkspaceIdFromBody: deps.getWorkspaceIdFromBody,
    logWorkspaceBotRoot: deps.logWorkspaceBotRoot,
    readSessionStateStrict: deps.readSessionStateStrict,
    persistSessionState: deps.persistSessionState,
    normalizeBuildChatProvider: deps.normalizeBuildChatProvider,
    persistBuildChatProviderMeta: deps.persistBuildChatProviderMeta,
  });
  if (legacyApiResponse) return legacyApiResponse;
  if (url.pathname === "/graphql/streams") {
    return handleGraphqlStreamMultiplexRequest(req);
  }
  if (url.pathname.startsWith(GRAPHQL_STREAMS_PREFIX)) {
    return handleDurableStreamRequest(req);
  }
  const simulatorGraphqlOperations: SimulatorGraphqlOperations = {
    listWorkspaces: () => Promise.resolve(deps.listSessions()),
    createWorkspace: async () => {
      const created = await deps.createWorkspaceSession();
      return { workspaceId: created.id };
    },
    deleteWorkspace: (workspaceId: string) => {
      const deleted = deps.deleteSessionState(workspaceId);
      if (deleted) {
        deps.deleteWorkspaceRuntime(workspaceId);
      }
      return Promise.resolve({ ok: deleted });
    },
    readWorkspaceBuildRun: (workspaceId: string) =>
      Promise.resolve(deps.readWorkspaceBuildRunForGraphql(workspaceId)),
    readWorkspaceOpenResponseEvents: (args: {
      workspaceId: string;
      runId: string;
      fromSequence?: number;
    }) =>
      Promise.resolve(
        deps.readWorkspaceOpenResponseEvents({
          workspaceId: args.workspaceId,
          runId: args.runId,
          fromSequence: args.fromSequence,
        }),
      ),
    readWorkspaceOpenResponseOutputItems: (args: {
      workspaceId: string;
      runId: string;
    }) =>
      Promise.resolve(
        deps.readWorkspaceOpenResponseOutputItems({
          workspaceId: args.workspaceId,
          runId: args.runId,
        }),
      ),
    subscribeWorkspaceOpenResponseEvents: (args: {
      workspaceId: string;
      runId: string;
      fromSequence?: number;
      signal?: AbortSignal;
    }) =>
      deps.subscribeWorkspaceOpenResponseEvents({
        workspaceId: args.workspaceId,
        runId: args.runId,
        fromSequence: args.fromSequence,
        signal: args.signal,
      }),
    createWorkspaceBuildRun: async (
      workspaceId: string,
      message: string,
      buildChatProvider?: BuildChatProvider,
    ) =>
      await deps.startWorkspaceBuildRun({
        workspaceId,
        message,
        buildChatProvider,
      }),
    stopWorkspaceBuildRun: async (workspaceId: string, runId: string) =>
      await deps.stopWorkspaceBuildRun({ workspaceId, runId }),
    resetWorkspaceBuild: async (workspaceId: string) =>
      await deps.resetWorkspaceBuild(workspaceId),
    createWorkspaceScenarioRun: async (args: {
      workspaceId: string;
      scenarioDeckId?: string | null;
      scenarioInput?: unknown;
      assistantInit?: unknown;
    }) =>
      asScenarioRunRecord(
        args.workspaceId,
        await deps.startWorkspaceScenarioRunForGraphql(args),
      ),
    sendWorkspaceScenarioRun: async (args: {
      workspaceId: string;
      runId: string;
      message: string;
    }) =>
      asScenarioRunRecord(
        args.workspaceId,
        await deps.sendWorkspaceScenarioRunForGraphql(args),
      ),
    saveWorkspaceFeedback: async (args) => {
      const result = await deps.saveWorkspaceFeedbackForGraphql(args);
      return {
        feedback: result.feedback,
        deleted: result.deleted,
        run: asScenarioRunRecord(args.workspaceId, result.run),
      };
    },
    stopWorkspaceScenarioRun: async (args: {
      workspaceId: string;
      runId: string;
    }) =>
      asScenarioRunRecord(
        args.workspaceId,
        await deps.stopWorkspaceScenarioRunForGraphql(args),
      ),
    readWorkspaceScenarioRuns: async (workspaceId: string) =>
      (await deps.readWorkspaceScenarioRunsForGraphql(workspaceId)).map((run) =>
        asScenarioRunRecord(workspaceId, run)
      ),
    readWorkspaceModelStatus: async (args: {
      workspaceId: string;
      model: "codex";
      checkOnline?: boolean;
    }) => {
      if (args.model !== "codex") {
        return {
          model: args.model,
          workspaceId: args.workspaceId,
          available: false,
          requiresLogin: false,
          loggedIn: false,
          statusText: "Model status is unavailable.",
          writeEnabled: false,
        };
      }
      const status = await deps.readCodexWorkspaceStatus(
        args.workspaceId,
        args.checkOnline,
      );
      const statusRecord = status as {
        writeEnabled: boolean;
        codexLoggedIn: boolean;
        codexLoginStatus: string;
        trustedPath?: boolean;
      };
      return {
        model: "codex" as const,
        workspaceId: args.workspaceId,
        available: statusRecord.writeEnabled && statusRecord.codexLoggedIn,
        requiresLogin: !statusRecord.codexLoggedIn,
        loggedIn: statusRecord.codexLoggedIn,
        statusText: statusRecord.codexLoginStatus,
        trustedPath: typeof statusRecord.trustedPath === "string"
          ? statusRecord.trustedPath
          : undefined,
        writeEnabled: statusRecord.writeEnabled,
      };
    },
    readWorkspaceGradeRuns: async (workspaceId: string) =>
      await deps.readWorkspaceGradeRunsForGraphql(workspaceId),
    readWorkspaceGradingFlags: async (workspaceId: string) =>
      await deps.readWorkspaceGradingFlagsForGraphql(workspaceId),
    createWorkspaceGradeRun: async (args: {
      workspaceId: string;
      graderId: string;
      scenarioRunId?: string | null;
    }) => await deps.createWorkspaceGradeRunForGraphql(args),
    toggleWorkspaceGradeFlag: async (args: {
      workspaceId: string;
      refId: string;
      runId: string;
      turnIndex?: number | null;
    }) => await deps.toggleWorkspaceGradeFlagForGraphql(args),
    updateWorkspaceGradeFlagReason: async (args: {
      workspaceId: string;
      refId: string;
      reason: string;
    }) => await deps.updateWorkspaceGradeFlagReasonForGraphql(args),
    readWorkspaceVerifyBatches: async (workspaceId: string) =>
      await deps.readWorkspaceVerifyBatchesForGraphql(workspaceId),
    createWorkspaceVerifyBatchRun: async (args: {
      workspaceId: string;
      scenarioDeckId?: string | null;
      graderId: string;
      scenarioRuns: number;
      graderRepeatsPerScenario: number;
      concurrency: number;
    }) => await deps.createWorkspaceVerifyBatchRunForGraphql(args),
    listWorkspaceConversationSessions: async (args: {
      workspaceId: string;
      kind?: WorkspaceConversationSessionKindForGraphql | null;
    }) =>
      (await deps.listWorkspaceConversationSessionsForGraphql(args)).map(
        (session) => asConversationSessionRecord(args.workspaceId, session),
      ),
    readWorkspaceConversationSession: async (args: {
      workspaceId: string;
      kind: WorkspaceConversationSessionKindForGraphql;
      sessionId: string;
    }) => {
      const session = await deps.readWorkspaceConversationSessionForGraphql(
        args,
      );
      return session
        ? asConversationSessionRecord(args.workspaceId, session)
        : null;
    },
    startWorkspaceConversationSession: async (args: {
      workspaceId: string;
      kind: WorkspaceConversationSessionKindForGraphql;
      sessionId?: string | null;
      message?: string | null;
      scenarioDeckId?: string | null;
      scenarioInput?: unknown;
      assistantInit?: unknown;
      graderId?: string | null;
      scenarioRunId?: string | null;
      scenarioRuns?: number | null;
      graderRepeatsPerScenario?: number | null;
      concurrency?: number | null;
    }) =>
      asConversationSessionRecord(
        args.workspaceId,
        await deps.startWorkspaceConversationSessionForGraphql(args),
      ),
    sendWorkspaceConversationSession: async (args: {
      workspaceId: string;
      kind: WorkspaceConversationSessionKindForGraphql;
      sessionId: string;
      message: string;
    }) =>
      asConversationSessionRecord(
        args.workspaceId,
        await deps.sendWorkspaceConversationSessionForGraphql(args),
      ),
    stopWorkspaceConversationSession: async (args: {
      workspaceId: string;
      kind: WorkspaceConversationSessionKindForGraphql;
      sessionId: string;
    }) =>
      asConversationSessionRecord(
        args.workspaceId,
        await deps.stopWorkspaceConversationSessionForGraphql(args),
      ),
    ...deps.workspaceDeckGraphqlOperations,
  };
  if (url.pathname === "/graphql/stream") {
    return await handleGraphqlSubscriptionStreamRequest(req, {
      readWorkspaceFiles,
      ...simulatorGraphqlOperations,
    });
  }
  if (url.pathname === "/graphql") {
    return await gambitYoga.fetch(req, {
      readWorkspaceFiles,
      ...simulatorGraphqlOperations,
    });
  }
  const openResponsesResponse = await handleOpenResponsesRequest({
    req,
    modelProvider: deps.modelProvider,
  });
  if (openResponsesResponse) return openResponsesResponse;

  const faviconResponse = await handleSimulatorFaviconRequest(req);
  if (faviconResponse) return faviconResponse;

  const pathRedirectResponse = handleSimulatorPathRedirect(url.pathname);
  if (pathRedirectResponse) return pathRedirectResponse;

  const uiRoutesResponse = await handleUiRoutes({
    url,
    workspaceRouteBase: deps.workspaceRouteBase,
    activeWorkspaceId: deps.activeWorkspaceId,
    activeWorkspaceOnboarding: deps.activeWorkspaceOnboarding,
    resolvedDeckPath: deps.getResolvedDeckPath(),
    deckLabel: deps.getDeckLabel(),
    getWorkspaceIdFromQuery: deps.getWorkspaceIdFromQuery,
    activateWorkspaceDeck: deps.activateWorkspaceDeck,
    schemaPromise: deps.schemaPromise(),
    deckLoadPromise: deps.deckLoadPromise(),
    canServeReactBundle,
    simulatorReactHtml,
    toDeckLabel: deps.toDeckLabel,
    readReactBundle,
    shouldAdvertiseSourceMap,
    readReactBundleSourceMap,
  });
  if (uiRoutesResponse) return uiRoutesResponse;

  return new Response("Not found", { status: 404 });
};
