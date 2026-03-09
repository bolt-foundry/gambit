import type { FeedbackEntry, SavedState } from "@bolt-foundry/gambit-core";
import { asGambitID } from "./gambit_id.ts";
import type { BuildChatProvider } from "./server_build_chat_provider.ts";
import type { WorkspaceDeckState } from "./server_types.ts";

type WorkspaceRecord = {
  id: string;
  rootDir: string;
  rootDeckPath: string;
  createdAt: string;
};

type ScenarioDeckRecord = WorkspaceDeckState["scenarioDecks"][number];

type ScenarioRunRecord = {
  id: string;
  status: string;
  workspaceId?: string;
  sessionId?: string;
  maxTurns?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  messages: Array<unknown>;
  traces?: Array<unknown>;
  toolInserts?: Array<unknown>;
};

type LiveScenarioRunEntry = {
  run: ScenarioRunRecord;
  promise: Promise<void> | null;
  abort: AbortController | null;
};

type BuildRunRecord = {
  id: string;
};

type WorkspaceFileRecord = {
  path: string;
  size: number | null;
  modifiedAt: string | null;
};

type BuildProviderStatusHandlerArgs = {
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
};

type LegacyApiRouteDeps = {
  req: Request;
  url: URL;
  activeWorkspaceId: string | null;
  workspaceApiBase: string;
  workspaceStateSchemaVersion: string;
  maxFilePreviewBytes: number;
  getWorkspaceIdFromQuery: (url: URL) => string | undefined;
  getWorkspaceIdFromBody: (
    body: Record<string, unknown> | null | undefined,
  ) => string | undefined;
  createWorkspaceSession: (
    opts?: { onboarding?: boolean },
  ) => Promise<WorkspaceRecord>;
  ensureWorkspaceSession: (workspaceId: string) => WorkspaceRecord;
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
  ) => ScenarioDeckRecord | undefined;
  readSessionState: (workspaceId: string) => SavedState | undefined;
  readSessionStateStrict: (
    workspaceId: string,
    opts?: { withTraces?: boolean },
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
  syncTestBotRunFromState: (
    run: ScenarioRunRecord,
    state: SavedState,
  ) => void;
  broadcastTestBot: (
    payload: { type: "testBotStatus"; run: ScenarioRunRecord },
    workspaceId: string,
  ) => void;
  getLiveTestRunEntry: (runId: string) => LiveScenarioRunEntry | undefined;
  startWorkspaceScenarioRunForGraphql: (args: {
    runId?: string;
    workspaceId: string;
    scenarioDeckId?: string | null;
    scenarioInput?: unknown;
    assistantInit?: unknown;
  }) => Promise<ScenarioRunRecord>;
  sendWorkspaceScenarioRunForGraphql: (args: {
    workspaceId: string;
    runId: string;
    message: string;
  }) => Promise<ScenarioRunRecord>;
  stopWorkspaceScenarioRunForGraphql: (args: {
    workspaceId: string;
    runId: string;
  }) => Promise<ScenarioRunRecord>;
  readWorkspaceScenarioRunsForGraphql: (
    workspaceId: string,
  ) => Array<{ id: string }>;
  handleBuildProviderStatusRequest: (
    args: BuildProviderStatusHandlerArgs,
  ) => Promise<Response>;
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
  }) => BuildRunRecord;
  stopWorkspaceBuildRun: (args: {
    workspaceId: string;
    runId: string;
  }) => Promise<unknown>;
  resetWorkspaceBuild: (workspaceId: string) => Promise<unknown>;
  readWorkspaceBuildRunForGraphql: (workspaceId: string) => BuildRunRecord;
  getLiveBuildRunEntry: (
    workspaceId: string,
  ) => { run: BuildRunRecord; promise: Promise<void> | null } | undefined;
  readWorkspaceFiles: (args: {
    workspaceId: ReturnType<typeof asGambitID>;
  }) => Promise<Array<WorkspaceFileRecord>>;
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
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const methodNotAllowed = (): Response =>
  new Response("Method not allowed", { status: 405 });

export const handleLegacyApiRoutes = async (
  deps: LegacyApiRouteDeps,
): Promise<Response | null> => {
  const { req, url } = deps;

  if (url.pathname === `${deps.workspaceApiBase}/new`) {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      let onboarding = false;
      try {
        const body = await req.json() as { onboarding?: unknown };
        onboarding = body.onboarding === true;
      } catch {
        // ignore malformed body
      }
      const workspace = await deps.createWorkspaceSession({ onboarding });
      await deps.activateWorkspaceDeck(workspace.id);
      return jsonResponse({
        workspaceId: workspace.id,
        deckPath: workspace.rootDeckPath,
        workspaceDir: workspace.rootDir,
        createdAt: workspace.createdAt,
        workspaceSchemaVersion: deps.workspaceStateSchemaVersion,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 500);
    }
  }

  if (url.pathname === `${deps.workspaceApiBase}/delete`) {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      const workspaceId = deps.getWorkspaceIdFromBody(body);
      if (!workspaceId) throw new Error("Missing workspaceId");
      const deleted = deps.deleteSessionState(workspaceId);
      if (!deleted) {
        return jsonResponse({ error: "Workspace not found" }, 404);
      }
      deps.deleteWorkspaceRuntime(workspaceId);
      return jsonResponse({ workspaceId, deleted: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname === `${deps.workspaceApiBase}/feedback`) {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as {
        workspaceId?: string;
        runId?: string;
        messageRefId?: string;
        score?: number | null;
        reason?: string;
      };
      const workspaceId = deps.getWorkspaceIdFromBody(body);
      if (!workspaceId) throw new Error("Missing workspaceId");
      if (!body.messageRefId) throw new Error("Missing messageRefId");
      if (
        body.score !== null &&
        (typeof body.score !== "number" || Number.isNaN(body.score))
      ) {
        throw new Error("Invalid score");
      }
      const state = deps.readSessionState(workspaceId);
      if (!state) throw new Error("Workspace not found");
      const requestedRunId = typeof body.runId === "string" &&
          body.runId.trim().length > 0
        ? body.runId.trim()
        : undefined;
      const feedbackEligible = deps.isFeedbackEligibleMessageRef(
        state,
        body.messageRefId,
      ) ||
        (requestedRunId
          ? deps.isFeedbackEligiblePersistedTestRunMessageRef(
            state,
            requestedRunId,
            body.messageRefId,
          )
          : false);
      if (!feedbackEligible) {
        throw new Error("Feedback target is not eligible");
      }
      const existing = state.feedback ?? [];
      const idx = existing.findIndex((entry) =>
        entry.messageRefId === body.messageRefId
      );
      let entry: FeedbackEntry | undefined;
      let feedback: Array<FeedbackEntry> = existing;
      let deleted = false;
      if (body.score === null) {
        if (idx >= 0) {
          feedback = existing.filter((_, i) => i !== idx);
          deleted = true;
        }
      } else {
        const clamped = Math.max(-3, Math.min(3, Math.round(body.score)));
        const reason = typeof body.reason === "string"
          ? body.reason
          : idx >= 0
          ? existing[idx].reason
          : undefined;
        const runId = requestedRunId ??
          (typeof state.runId === "string" ? state.runId : "session");
        const scenarioRunId = requestedRunId ??
          (typeof state.meta?.scenarioRunId === "string"
            ? state.meta.scenarioRunId
            : runId);
        const now = new Date().toISOString();
        entry = idx >= 0
          ? {
            ...existing[idx],
            score: clamped,
            reason,
            runId: existing[idx].runId ?? runId,
          }
          : {
            id: deps.randomId("fb"),
            runId,
            messageRefId: body.messageRefId,
            score: clamped,
            reason,
            createdAt: now,
          };
        if (entry) {
          (entry as Record<string, unknown>).workspaceId = workspaceId;
          (entry as Record<string, unknown>).scenarioRunId = scenarioRunId;
        }
        feedback = idx >= 0
          ? existing.map((item, i) => i === idx ? entry! : item)
          : [...existing, entry];
      }
      const nextState = deps.persistSessionState({ ...state, feedback });
      deps.appendSessionEvent(nextState, {
        type: "feedback.update",
        kind: "artifact",
        category: "feedback",
        workspaceId,
        scenarioRunId: typeof nextState.meta?.scenarioRunId === "string"
          ? nextState.meta.scenarioRunId
          : nextState.runId,
        messageRefId: body.messageRefId,
        feedback: entry,
        deleted,
      });
      const testBotRunId = typeof nextState.meta?.testBotRunId === "string"
        ? nextState.meta.testBotRunId
        : undefined;
      if (testBotRunId) {
        const testEntry = deps.getLiveTestRunEntry(testBotRunId);
        if (testEntry) {
          deps.syncTestBotRunFromState(testEntry.run, nextState);
          deps.broadcastTestBot(
            { type: "testBotStatus", run: testEntry.run },
            workspaceId,
          );
        }
      }
      return jsonResponse({
        workspaceId,
        feedback: entry,
        saved: !deleted,
        deleted,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname === "/api/test") {
    if (req.method !== "GET") return methodNotAllowed();
    try {
      const workspaceId = deps.getWorkspaceIdFromQuery(url) ??
        deps.activeWorkspaceId;
      await deps.logWorkspaceBotRoot("/api/test", workspaceId);
      const deckState = workspaceId
        ? (await deps.activateWorkspaceDeck(workspaceId),
          deps.readWorkspaceDeckStateStrict(workspaceId))
        : await deps.readPrimaryDeckState();
      const requestedDeck = url.searchParams.get("deckPath");
      const selection = requestedDeck
        ? deckState
          ? deps.resolveScenarioDeckFromState(deckState, requestedDeck)
          : undefined
        : deckState?.scenarioDecks[0];
      if (requestedDeck && !selection) {
        return jsonResponse({ error: "Unknown scenario deck selection" }, 400);
      }
      if (!selection) {
        return jsonResponse({
          botPath: null,
          botLabel: null,
          botDescription: null,
          selectedDeckId: null,
          inputSchema: null,
          inputSchemaError: null,
          defaults: {},
          testDecks: deckState?.scenarioDecks ?? [],
        });
      }
      return jsonResponse({
        botPath: selection.path,
        botLabel: selection.label,
        botDescription: selection.description,
        selectedDeckId: selection.id,
        inputSchema: selection.inputSchema ?? null,
        inputSchemaError: selection.inputSchemaError ?? null,
        defaults: { input: selection.defaults },
        testDecks: deckState?.scenarioDecks ?? [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname === "/api/test/run") {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      let workspaceId = deps.getWorkspaceIdFromBody(body);
      if (!workspaceId) {
        const created = await deps.createWorkspaceSession();
        workspaceId = created.id;
      }
      deps.ensureWorkspaceSession(workspaceId);
      await deps.logWorkspaceBotRoot("/api/test/run", workspaceId);
      await deps.activateWorkspaceDeck(workspaceId);
      let run = await deps.startWorkspaceScenarioRunForGraphql({
        workspaceId,
        scenarioDeckId: typeof body.botDeckPath === "string"
          ? body.botDeckPath
          : typeof body.scenarioDeckId === "string"
          ? body.scenarioDeckId
          : null,
        scenarioInput: body.botInput,
        assistantInit: body.context ?? body.init,
      });
      const initialUserMessage = typeof body.initialUserMessage === "string"
        ? body.initialUserMessage.trim()
        : "";
      if (initialUserMessage.length > 0) {
        run = await deps.sendWorkspaceScenarioRunForGraphql({
          workspaceId,
          runId: run.id,
          message: initialUserMessage,
        });
      }
      const liveRun = deps.getLiveTestRunEntry(run.id)?.run;
      const runPayload = liveRun?.maxTurns !== undefined
        ? { ...run, maxTurns: liveRun.maxTurns }
        : run;
      return jsonResponse({ run: runPayload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname === "/api/test/message") {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      let workspaceId = deps.getWorkspaceIdFromBody(body);
      const requestedRunId = typeof body.runId === "string"
        ? body.runId.trim()
        : "";
      if (!workspaceId && requestedRunId) {
        const active = deps.getLiveTestRunEntry(requestedRunId)?.run;
        workspaceId = active?.workspaceId ?? active?.sessionId;
      }
      if (!workspaceId) {
        const created = await deps.createWorkspaceSession();
        workspaceId = created.id;
      }
      deps.ensureWorkspaceSession(workspaceId);
      await deps.logWorkspaceBotRoot("/api/test/message", workspaceId);
      await deps.activateWorkspaceDeck(workspaceId);
      const existingRun = requestedRunId.length > 0
        ? deps.readWorkspaceScenarioRunsForGraphql(workspaceId).find((run) =>
          run.id === requestedRunId
        )
        : undefined;
      let runId = existingRun?.id;
      if (!runId) {
        const started = await deps.startWorkspaceScenarioRunForGraphql({
          runId: requestedRunId || undefined,
          workspaceId,
          scenarioDeckId: typeof body.botDeckPath === "string"
            ? body.botDeckPath
            : typeof body.scenarioDeckId === "string"
            ? body.scenarioDeckId
            : null,
          scenarioInput: body.botInput,
          assistantInit: body.context ?? body.init,
        });
        runId = started.id;
        const initialMessage = typeof body.message === "string"
          ? body.message.trim()
          : "";
        if (initialMessage.length === 0) {
          const liveStarted = deps.getLiveTestRunEntry(started.id)?.run;
          const startedPayload = liveStarted?.maxTurns !== undefined
            ? { ...started, maxTurns: liveStarted.maxTurns }
            : started;
          return jsonResponse({ run: startedPayload });
        }
      }
      const message = typeof body.message === "string" ? body.message : "";
      const run = await deps.sendWorkspaceScenarioRunForGraphql({
        workspaceId,
        runId,
        message,
      });
      const liveRun = deps.getLiveTestRunEntry(run.id)?.run;
      const runPayload = liveRun?.maxTurns !== undefined
        ? { ...run, maxTurns: liveRun.maxTurns }
        : run;
      return jsonResponse({ run: runPayload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname === "/api/test/stop") {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as {
        runId?: unknown;
        workspaceId?: unknown;
      };
      const runId = typeof body.runId === "string" ? body.runId : "";
      if (!runId) {
        return jsonResponse({
          stopped: false,
          run: {
            id: "",
            status: "idle",
            messages: [],
            traces: [],
            toolInserts: [],
          },
        });
      }
      const existing = deps.getLiveTestRunEntry(runId);
      const workspaceId = typeof body.workspaceId === "string"
        ? body.workspaceId
        : existing?.run.workspaceId ?? existing?.run.sessionId;
      const wasRunning = Boolean(existing?.promise);
      if (!workspaceId) {
        existing?.abort?.abort();
        return jsonResponse({
          stopped: wasRunning,
          run: existing?.run ?? {
            id: runId,
            status: "idle",
            messages: [],
            traces: [],
            toolInserts: [],
          },
        });
      }
      const run = await deps.stopWorkspaceScenarioRunForGraphql({
        workspaceId,
        runId,
      });
      return jsonResponse({ stopped: wasRunning, run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (
    url.pathname === "/api/codex/trust-workspace" ||
    url.pathname === "/api/build/provider-status"
  ) {
    if (req.method !== "GET" && req.method !== "POST") {
      return methodNotAllowed();
    }
    return await deps.handleBuildProviderStatusRequest({
      req,
      url,
      isLegacyCodexTrustEndpoint: url.pathname === "/api/codex/trust-workspace",
      getWorkspaceIdFromQuery: deps.getWorkspaceIdFromQuery,
      logWorkspaceBotRoot: deps.logWorkspaceBotRoot,
      readCodexWorkspaceStatus: deps.readCodexWorkspaceStatus,
    });
  }

  if (url.pathname === "/api/simulator/run") {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      const requestedWorkspaceId = deps.getWorkspaceIdFromBody(body);
      let workspaceId = requestedWorkspaceId;
      if (!workspaceId) {
        const created = await deps.createWorkspaceSession();
        workspaceId = created.id;
      }
      if (requestedWorkspaceId) {
        try {
          deps.readSessionStateStrict(requestedWorkspaceId, {
            withTraces: true,
          });
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : String(error);
          return jsonResponse({ error: message }, 400);
        }
      }
      deps.ensureWorkspaceSession(workspaceId);
      await deps.logWorkspaceBotRoot(url.pathname, workspaceId);
      await deps.activateWorkspaceDeck(workspaceId);
      let run = await deps.startWorkspaceScenarioRunForGraphql({
        workspaceId,
        scenarioDeckId: typeof body.botDeckPath === "string"
          ? body.botDeckPath
          : typeof body.scenarioDeckId === "string"
          ? body.scenarioDeckId
          : null,
        scenarioInput: body.botInput,
        assistantInit: body.context ?? body.init ??
          (typeof body.input === "string"
            ? JSON.stringify(body.input)
            : body.input),
      });
      const initialUserMessage = typeof body.message === "string"
        ? body.message.trim()
        : "";
      if (initialUserMessage.length > 0) {
        run = await deps.sendWorkspaceScenarioRunForGraphql({
          workspaceId,
          runId: run.id,
          message: initialUserMessage,
        });
      }
      const liveRun = deps.getLiveTestRunEntry(run.id)?.run;
      const runPayload = liveRun?.maxTurns !== undefined
        ? { ...run, maxTurns: liveRun.maxTurns }
        : run;
      return jsonResponse({
        run: runPayload,
        runId: run.id,
        workspaceId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname === "/api/build/message") {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      let workspaceId = deps.getWorkspaceIdFromBody(body);
      if (!workspaceId && typeof body.runId === "string") {
        workspaceId = body.runId;
      }
      if (!workspaceId) {
        const created = await deps.createWorkspaceSession();
        workspaceId = created.id;
      }
      deps.ensureWorkspaceSession(workspaceId);
      await deps.logWorkspaceBotRoot(url.pathname, workspaceId);
      await deps.activateWorkspaceDeck(workspaceId);
      const buildChatProvider =
        deps.normalizeBuildChatProvider(body.buildChatProvider) ?? undefined;
      if (buildChatProvider) {
        const state = deps.readSessionStateStrict(workspaceId, {
          withTraces: true,
        });
        if (state) {
          deps.persistSessionState(
            deps.persistBuildChatProviderMeta(
              state,
              workspaceId,
              buildChatProvider,
            ),
          );
        }
      }
      const message = typeof body.message === "string"
        ? body.message
        : typeof body.input === "string"
        ? body.input
        : "";
      const run = deps.startWorkspaceBuildRun({
        workspaceId,
        message,
        buildChatProvider,
      });
      return jsonResponse({ run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("already in progress") ? 409 : 400;
      return jsonResponse({ error: message }, status);
    }
  }

  if (url.pathname === "/api/build/stop") {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      const workspaceId = deps.getWorkspaceIdFromBody(body);
      if (!workspaceId) throw new Error("Missing workspaceId");
      const active = deps.getLiveBuildRunEntry(workspaceId);
      const wasRunning = Boolean(active?.promise);
      const runId = active?.run.id ?? deps.readWorkspaceBuildRunForGraphql(
        workspaceId,
      ).id;
      const run = await deps.stopWorkspaceBuildRun({ workspaceId, runId });
      return jsonResponse({ stopped: wasRunning, run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname === "/api/build/provider") {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      const workspaceId = deps.getWorkspaceIdFromBody(body);
      if (!workspaceId) throw new Error("Missing workspaceId");
      const buildChatProvider = deps.normalizeBuildChatProvider(
        body.buildChatProvider,
      );
      if (!buildChatProvider) {
        throw new Error(
          "Invalid buildChatProvider; expected codex-cli or claude-code-cli",
        );
      }
      await deps.logWorkspaceBotRoot(url.pathname, workspaceId);
      const state = deps.readSessionStateStrict(workspaceId, {
        withTraces: true,
      });
      if (!state) throw new Error("Workspace not found");
      deps.persistSessionState(
        deps.persistBuildChatProviderMeta(
          state,
          workspaceId,
          buildChatProvider,
        ),
      );
      return jsonResponse({ ok: true, workspaceId, buildChatProvider });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname === "/api/build/reset") {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      const workspaceId = deps.getWorkspaceIdFromBody(body);
      if (!workspaceId) throw new Error("Missing workspaceId");
      const run = await deps.resetWorkspaceBuild(workspaceId);
      return jsonResponse({ reset: true, run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname === "/api/build/files") {
    if (req.method !== "GET") return methodNotAllowed();
    try {
      const workspaceId = deps.getWorkspaceIdFromQuery(url) ??
        deps.activeWorkspaceId ??
        "";
      await deps.logWorkspaceBotRoot("/api/build/files", workspaceId);
      const root = await deps.resolveBuildBotRoot(workspaceId);
      const records = await deps.readWorkspaceFiles({
        workspaceId: asGambitID(workspaceId),
      });
      const entries = records.map((record) => ({
        path: record.path,
        type: "file" as const,
        size: typeof record.size === "number" ? record.size : undefined,
        modifiedAt: record.modifiedAt ?? undefined,
      }));
      return jsonResponse({ root, entries });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname === "/api/build/file") {
    if (req.method !== "GET") return methodNotAllowed();
    const workspaceId = deps.getWorkspaceIdFromQuery(url) ??
      deps.activeWorkspaceId ??
      "";
    await deps.logWorkspaceBotRoot("/api/build/file", workspaceId);
    const inputPath = url.searchParams.get("path") ?? "";
    if (!inputPath) {
      return jsonResponse({ error: "Missing path" }, 400);
    }
    try {
      const root = await deps.resolveBuildBotRoot(workspaceId);
      const resolved = await deps.resolveBuildBotPath(root, inputPath);
      if (!resolved.stat.isFile) {
        return jsonResponse({ error: "Path is not a file" }, 400);
      }
      if (
        typeof resolved.stat.size === "number" &&
        resolved.stat.size > deps.maxFilePreviewBytes
      ) {
        return jsonResponse({
          path: resolved.relativePath,
          tooLarge: true,
          size: resolved.stat.size,
        });
      }
      const bytes = await Deno.readFile(resolved.fullPath);
      const text = deps.readPreviewText(bytes);
      if (text === null) {
        return jsonResponse({
          path: resolved.relativePath,
          binary: true,
          size: resolved.stat.size,
        });
      }
      return jsonResponse({
        path: resolved.relativePath,
        contents: text,
        size: resolved.stat.size,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }

  return null;
};
