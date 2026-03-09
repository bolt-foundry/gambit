import * as path from "@std/path";
import {
  isGambitEndSignal,
  isRunCanceledError,
  runDeck,
} from "@bolt-foundry/gambit-core";
import type {
  ModelMessage,
  ModelProvider,
  SavedState,
  TraceEvent,
} from "@bolt-foundry/gambit-core";
import { sanitizeNumber } from "../../test_bot.ts";
import type {
  NormalizedSchema,
  SchemaDescription,
  WorkspaceDeckState,
} from "../../server_types.ts";
import type { WorkspaceRecord } from "../../server_workspace_runtime.ts";
import { cloneValue, deriveInitialFromSchema } from "./schema.ts";
import type {
  TestBotInitFill,
  TestBotRunEntry,
  TestBotRunStatus,
} from "./types.ts";
import {
  applyUserMessageRefSource,
  buildTestBotSnapshot,
  stringifyContent,
  syncTestBotRunFromState,
} from "./helpers.ts";
import {
  resolveWorkerSandboxForSignalAwareRun,
  runDeckWithFallback,
  stringifyOutput,
} from "./run_deck.ts";
import {
  isFeedbackEligibleMessageRef,
  isFeedbackEligiblePersistedTestRunMessageRef,
  listPersistedTestRunStatuses,
  listScenarioRunStatusesFromStateMeta,
  readPersistedTestRunStatusById,
} from "./scenario_history.ts";

const DEFAULT_TEST_BOT_SEED_PROMPT =
  "Start the conversation as the user. Do not wait for the assistant to speak first.";

const traceCategory = (type: string): string => {
  switch (type) {
    case "message.user":
    case "model.result":
      return "turn";
    case "tool.call":
    case "tool.result":
      return "tool";
    case "log":
    case "monolog":
      return "status";
    case "run.start":
    case "run.end":
    case "deck.start":
    case "deck.end":
    case "action.start":
    case "action.end":
    case "model.call":
      return "lifecycle";
    default:
      return "trace";
  }
};

export const createWorkspaceScenarioService = (deps: {
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  responsesMode?: boolean;
  workerSandbox?: boolean;
  consoleTracer?: ((event: TraceEvent) => void) | undefined;
  logger: {
    error: (...args: Array<unknown>) => void;
    warn: (...args: Array<unknown>) => void;
  };
  randomId: (prefix: string) => string;
  getResolvedDeckPath: () => string;
  getRootStartMode: () => "assistant" | "user" | undefined;
  getSchemaPromise: () => Promise<SchemaDescription>;
  buildWorkspaceMeta: (
    record: { id: string; rootDir: string; rootDeckPath: string },
    base?: Record<string, unknown>,
  ) => Record<string, unknown>;
  selectCanonicalScenarioRunSummary: (
    meta: Record<string, unknown>,
  ) => { scenarioRunId: string } | null;
  persistSessionState: (state: SavedState) => SavedState;
  appendSessionEvent: (
    state: SavedState,
    event: Record<string, unknown>,
  ) => void;
  appendWorkspaceEnvelope: (
    state: SavedState,
    domain: "test",
    payload: unknown,
  ) => void;
  appendDurableStreamEvent: (streamId: string, payload: unknown) => void;
  workspaceStreamId: string;
  testStreamId: string;
  persistOpenResponsesTraceEvent: (
    state: SavedState | null | undefined,
    trace: TraceEvent,
    fallbackRunId?: string,
  ) => void;
  persistCanonicalUserInputEvent: (args: {
    state: SavedState | null | undefined;
    runId: string;
    message: string;
    source: "build" | "scenario";
  }) => void;
  readSessionState: (workspaceId: string) => SavedState | undefined;
  readSessionStateStrict: (
    workspaceId: string,
    options?: { withTraces?: boolean },
  ) => SavedState | undefined;
  activateWorkspaceDeck: (
    workspaceId?: string | null,
    options?: {
      forceReload?: boolean;
      source?: string;
      reloadAttemptId?: string;
    },
  ) => Promise<void>;
  resolveWorkspaceRecord: (
    workspaceId: string,
  ) => WorkspaceRecord | null | undefined;
  readWorkspaceDeckStateStrict: (workspaceId: string) => WorkspaceDeckState;
  buildRootScenarioFallback: (
    deckState: WorkspaceDeckState,
  ) => WorkspaceDeckState["scenarioDecks"][number] | null;
  resolveScenarioDeckFromState: (
    deckState: WorkspaceDeckState,
    identifier: string,
  ) => WorkspaceDeckState["scenarioDecks"][number] | undefined;
}) => {
  const testBotRuns = new Map<string, TestBotRunEntry>();

  const shouldPersistTestWorkspaceEvent = (
    payload: unknown,
  ): payload is Record<string, unknown> => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return false;
    }
    const type = (payload as { type?: unknown }).type;
    return type === "testBotStatus" || type === "gambit.test.status";
  };

  const broadcastTestBot = (payload: unknown, workspaceId?: string) => {
    if (workspaceId && shouldPersistTestWorkspaceEvent(payload)) {
      const state = deps.readSessionState(workspaceId);
      if (state) {
        deps.appendWorkspaceEnvelope(state, "test", payload);
      }
    }
    deps.appendDurableStreamEvent(deps.workspaceStreamId, payload);
    deps.appendDurableStreamEvent(deps.testStreamId, payload);
  };

  const findTestRunByWorkspaceId = (
    workspaceId: string,
  ): TestBotRunEntry | undefined => {
    for (const candidate of testBotRuns.values()) {
      if (
        candidate.run.workspaceId === workspaceId ||
        candidate.run.sessionId === workspaceId
      ) {
        return candidate;
      }
    }
    return undefined;
  };

  const startTestBotRun = (runOpts: {
    runId?: string;
    maxTurnsOverride?: number;
    deckInput?: unknown;
    botInput?: unknown;
    initialUserMessage?: string;
    botDeckPath?: string;
    botDeckId?: string;
    botDeckLabel?: string;
    initFill?: TestBotInitFill;
    initFillTrace?: {
      args: Record<string, unknown>;
      result: Record<string, unknown>;
    };
    workspaceId?: string;
    workspaceRecord?: { id: string; rootDir: string; rootDeckPath: string };
    baseMeta?: Record<string, unknown>;
  } = {}): TestBotRunStatus => {
    const botDeckPath = typeof runOpts.botDeckPath === "string"
      ? runOpts.botDeckPath
      : undefined;
    if (!botDeckPath) {
      throw new Error("Missing scenario deck path");
    }
    const defaultMaxTurns = 12;
    const maxTurns = Math.round(
      sanitizeNumber(
        runOpts.maxTurnsOverride ?? defaultMaxTurns,
        defaultMaxTurns,
        { min: 1, max: 200 },
      ),
    );
    const deckInput = runOpts.deckInput;
    const hasDeckInput = deckInput !== undefined;
    const botInput: unknown = runOpts.botInput;
    const initialUserMessage = typeof runOpts.initialUserMessage === "string"
      ? runOpts.initialUserMessage.trim()
      : "";
    const botConfigPath = botDeckPath;
    const testBotName = path.basename(botConfigPath).replace(
      /\.deck\.(md|ts)$/i,
      "",
    );
    const selectedScenarioDeckId = runOpts.botDeckId ?? testBotName;
    const selectedScenarioDeckLabel = runOpts.botDeckLabel ?? testBotName;
    const runId = typeof runOpts.runId === "string" &&
        runOpts.runId.trim().length > 0
      ? runOpts.runId.trim()
      : deps.randomId("testbot");
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const entry: TestBotRunEntry = {
      run: {
        id: runId,
        status: "running",
        startedAt,
        maxTurns,
        messages: [],
        traces: [],
        toolInserts: [],
      },
      state: null,
      promise: null,
      abort: controller,
    };
    testBotRuns.set(runId, entry);
    const run = entry.run;
    if (runOpts.workspaceId) {
      run.workspaceId = runOpts.workspaceId;
      run.sessionId = runOpts.workspaceId;
    }
    const emitTestBot = (payload: unknown) =>
      broadcastTestBot(payload, run.workspaceId ?? runOpts.workspaceId);
    if (runOpts.initFill) run.initFill = runOpts.initFill;
    let savedState: SavedState | undefined = undefined;
    const baseMeta = runOpts.baseMeta ?? {};
    const workspaceMeta = runOpts.workspaceRecord
      ? deps.buildWorkspaceMeta(runOpts.workspaceRecord, baseMeta)
      : baseMeta;
    let lastCount = 0;
    const capturedTraces: Array<TraceEvent> = [];
    if (runOpts.initFillTrace) {
      const actionCallId = deps.randomId("initfill");
      capturedTraces.push(
        {
          type: "tool.call",
          runId,
          actionCallId,
          name: "gambit_test_bot_init_fill",
          args: runOpts.initFillTrace.args as never,
          toolKind: "internal",
        },
        {
          type: "tool.result",
          runId,
          actionCallId,
          name: "gambit_test_bot_init_fill",
          result: runOpts.initFillTrace.result as never,
          toolKind: "internal",
        },
      );
    }

    const setWorkspaceId = (state: SavedState | undefined) => {
      const workspaceId = typeof state?.meta?.workspaceId === "string"
        ? state.meta.workspaceId
        : typeof state?.meta?.sessionId === "string"
        ? state.meta.sessionId
        : undefined;
      if (workspaceId) {
        run.workspaceId = workspaceId;
        run.sessionId = workspaceId;
      }
    };

    const appendFromState = (state: SavedState) => {
      const snapshot = buildTestBotSnapshot(state);
      const rawLength = state.messages?.length ?? 0;
      const toolCount = snapshot.toolInserts.length;
      const shouldBroadcast = rawLength !== lastCount ||
        (run.toolInserts?.length ?? 0) !== toolCount;
      run.messages = snapshot.messages;
      run.toolInserts = snapshot.toolInserts;
      lastCount = rawLength;
      setWorkspaceId(state);
      run.traces = Array.isArray(state.traces) ? [...state.traces] : undefined;
      if (shouldBroadcast) {
        emitTestBot({ type: "testBotStatus", run });
      }
    };

    const pendingTraceEvents: Array<TraceEvent> = [];
    const flushPendingTraceEvents = (state: SavedState) => {
      if (!pendingTraceEvents.length) return;
      for (const pending of pendingTraceEvents) {
        deps.persistOpenResponsesTraceEvent(state, pending, runId);
        deps.appendSessionEvent(state, {
          ...pending,
          kind: "trace",
          category: traceCategory(pending.type),
        } as Record<string, unknown>);
      }
      pendingTraceEvents.length = 0;
    };
    const tracer = (event: TraceEvent) => {
      const stamped = event.ts ? event : { ...event, ts: Date.now() };
      capturedTraces.push(stamped);
      deps.consoleTracer?.(stamped);
      if (savedState?.meta?.sessionId) {
        deps.persistOpenResponsesTraceEvent(savedState, stamped, runId);
        deps.appendSessionEvent(savedState, {
          ...stamped,
          kind: "trace",
          category: traceCategory(stamped.type),
        } as Record<string, unknown>);
      } else {
        pendingTraceEvents.push(stamped);
      }
    };

    let deckBotState: SavedState | undefined = undefined;
    let sessionEnded = false;

    const getLastAssistantMessage = (
      history: Array<ModelMessage | null | undefined>,
    ): string | undefined => {
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg?.role === "assistant") {
          return stringifyContent(msg.content);
        }
      }
      return undefined;
    };

    const generateDeckBotUserMessage = async (
      history: Array<ModelMessage | null | undefined>,
      streamOptions?: {
        onStreamText?: (chunk: string) => void;
        allowEmptyAssistant?: boolean;
      },
    ): Promise<string> => {
      const assistantMessage = getLastAssistantMessage(history)?.trim() || "";
      const seedPrompt = !assistantMessage && streamOptions?.allowEmptyAssistant
        ? DEFAULT_TEST_BOT_SEED_PROMPT
        : undefined;
      if (!assistantMessage && !seedPrompt) return "";
      const result = await runDeckWithFallback({
        path: botDeckPath,
        input: botInput,
        inputProvided: botInput !== undefined,
        modelProvider: deps.modelProvider,
        state: deckBotState,
        allowRootStringInput: true,
        initialUserMessage: assistantMessage || seedPrompt,
        onStateUpdate: (state) => {
          deckBotState = state;
        },
        stream: Boolean(streamOptions?.onStreamText),
        onStreamText: streamOptions?.onStreamText,
        responsesMode: deps.responsesMode,
        workerSandbox: deps.workerSandbox,
        signal: controller.signal,
      });
      if (isGambitEndSignal(result)) {
        sessionEnded = true;
        return "";
      }
      const text = stringifyOutput(result);
      return text.trim();
    };

    const loop = async () => {
      try {
        const effectiveStartMode = deps.getRootStartMode() ?? "assistant";
        const shouldRunInitial = effectiveStartMode !== "user" ||
          Boolean(initialUserMessage);
        if (!controller.signal.aborted && shouldRunInitial) {
          const initialResult = await runDeck({
            path: deps.getResolvedDeckPath(),
            input: deckInput,
            inputProvided: hasDeckInput,
            modelProvider: deps.modelProvider,
            defaultModel: deps.model,
            modelOverride: deps.modelForce,
            trace: tracer,
            stream: false,
            state: savedState,
            allowRootStringInput: true,
            initialUserMessage: initialUserMessage || undefined,
            responsesMode: deps.responsesMode,
            workerSandbox: resolveWorkerSandboxForSignalAwareRun({
              workerSandbox: deps.workerSandbox,
              signal: controller.signal,
            }),
            signal: controller.signal,
            onStateUpdate: (state) => {
              const nextStateWithSource = applyUserMessageRefSource(
                savedState,
                state,
                "scenario",
              );
              const nextMeta = {
                ...workspaceMeta,
                ...(nextStateWithSource.meta ?? {}),
                testBot: true,
                testBotRunId: runId,
                testBotConfigPath: botConfigPath,
                testBotName,
                scenarioRunId: runId,
                selectedScenarioDeckId,
                selectedScenarioDeckLabel,
                scenarioConfigPath: botConfigPath,
                ...(run.initFill ? { testBotInitFill: run.initFill } : {}),
                ...(runOpts.workspaceId
                  ? { workspaceId: runOpts.workspaceId }
                  : {}),
              };
              const enriched = deps.persistSessionState({
                ...nextStateWithSource,
                meta: nextMeta,
                traces: capturedTraces,
              });
              savedState = enriched;
              entry.state = enriched;
              flushPendingTraceEvents(enriched);
              appendFromState(enriched);
            },
          });
          if (isGambitEndSignal(initialResult)) {
            sessionEnded = true;
          }
        }
        for (let turn = 0; turn < maxTurns; turn++) {
          if (sessionEnded) break;
          if (controller.signal.aborted) break;
          const history = savedState?.messages ?? [];
          const userMessage = await generateDeckBotUserMessage(history, {
            onStreamText: (chunk) =>
              emitTestBot({
                type: "testBotStream",
                workspaceId: run.workspaceId ?? runOpts.workspaceId,
                runId,
                role: "user",
                chunk,
                turn,
                ts: Date.now(),
              }),
            allowEmptyAssistant: effectiveStartMode === "user" &&
              !getLastAssistantMessage(history),
          });
          emitTestBot({
            type: "testBotStreamEnd",
            workspaceId: run.workspaceId ?? runOpts.workspaceId,
            runId,
            role: "user",
            turn,
            ts: Date.now(),
          });
          if (!userMessage) break;
          const rootResult = await runDeck({
            path: deps.getResolvedDeckPath(),
            input: deckInput,
            inputProvided: hasDeckInput,
            modelProvider: deps.modelProvider,
            defaultModel: deps.model,
            modelOverride: deps.modelForce,
            trace: tracer,
            stream: true,
            state: savedState,
            allowRootStringInput: true,
            initialUserMessage: userMessage,
            responsesMode: deps.responsesMode,
            workerSandbox: resolveWorkerSandboxForSignalAwareRun({
              workerSandbox: deps.workerSandbox,
              signal: controller.signal,
            }),
            signal: controller.signal,
            onStateUpdate: (state) => {
              const nextStateWithSource = applyUserMessageRefSource(
                savedState,
                state,
                "scenario",
              );
              const nextMeta = {
                ...workspaceMeta,
                ...(nextStateWithSource.meta ?? {}),
                testBot: true,
                testBotRunId: runId,
                testBotConfigPath: botConfigPath,
                testBotName,
                scenarioRunId: runId,
                selectedScenarioDeckId,
                selectedScenarioDeckLabel,
                scenarioConfigPath: botConfigPath,
                ...(run.initFill ? { testBotInitFill: run.initFill } : {}),
                ...(runOpts.workspaceId
                  ? { workspaceId: runOpts.workspaceId }
                  : {}),
              };
              const enriched = deps.persistSessionState({
                ...nextStateWithSource,
                meta: nextMeta,
                traces: capturedTraces,
              });
              savedState = enriched;
              entry.state = enriched;
              flushPendingTraceEvents(enriched);
              appendFromState(enriched);
            },
            onStreamText: (chunk) =>
              emitTestBot({
                type: "testBotStream",
                workspaceId: run.workspaceId ?? runOpts.workspaceId,
                runId,
                role: "assistant",
                chunk,
                turn,
                ts: Date.now(),
              }),
          });
          if (isGambitEndSignal(rootResult)) {
            sessionEnded = true;
            break;
          }
          emitTestBot({
            type: "testBotStreamEnd",
            workspaceId: run.workspaceId ?? runOpts.workspaceId,
            runId,
            role: "assistant",
            turn,
            ts: Date.now(),
          });
        }
        run.status = controller.signal.aborted ? "canceled" : "completed";
        emitTestBot({ type: "testBotStatus", run });
      } catch (err) {
        if (controller.signal.aborted || isRunCanceledError(err)) {
          run.status = "canceled";
          run.error = undefined;
        } else {
          run.status = "error";
          run.error = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          deps.logger.error(
            `[sim] scenario run failed runId=${runId} workspaceId=${
              run.workspaceId ?? runOpts.workspaceId ?? "unknown"
            } rootDeck=${deps.getResolvedDeckPath()} scenarioDeck=${botDeckPath} error=${run.error}${
              stack ? `\n${stack}` : ""
            }`,
          );
        }
        emitTestBot({ type: "testBotStatus", run });
      } finally {
        if (savedState?.messages) {
          const snapshot = buildTestBotSnapshot(savedState);
          run.messages = snapshot.messages;
          run.toolInserts = snapshot.toolInserts;
        }
        setWorkspaceId(savedState);
        run.traces = Array.isArray(savedState?.traces)
          ? [...(savedState?.traces ?? [])]
          : undefined;
        if (savedState) {
          entry.state = savedState;
        }
        run.finishedAt = new Date().toISOString();
        entry.abort = null;
        entry.promise = null;
        emitTestBot({ type: "testBotStatus", run });
      }
    };

    entry.promise = loop();
    emitTestBot({ type: "testBotStatus", run });
    return run;
  };

  const startWorkspaceScenarioRunForGraphql = async (args: {
    workspaceId: string;
    runId?: string;
    scenarioDeckId?: string | null;
    scenarioInput?: unknown;
    assistantInit?: unknown;
  }): Promise<TestBotRunStatus> => {
    await deps.activateWorkspaceDeck(args.workspaceId, { forceReload: true });
    const workspaceRecord = deps.resolveWorkspaceRecord(args.workspaceId);
    if (!workspaceRecord) {
      throw new Error("Workspace not found");
    }
    const deckState = deps.readWorkspaceDeckStateStrict(args.workspaceId);
    const requestedDeckId = typeof args.scenarioDeckId === "string" &&
        args.scenarioDeckId.trim().length > 0
      ? args.scenarioDeckId.trim()
      : null;
    const fallbackScenarioDeck = deps.buildRootScenarioFallback(deckState);
    const scenarioDeck = requestedDeckId
      ? deps.resolveScenarioDeckFromState(deckState, requestedDeckId) ??
        (requestedDeckId === deckState.assistantDeck.deck
          ? fallbackScenarioDeck
          : null)
      : fallbackScenarioDeck;
    if (requestedDeckId && !scenarioDeck) {
      throw new Error("Unknown scenario deck selection");
    }
    if (!scenarioDeck) {
      throw new Error("No scenario deck configured for this workspace.");
    }
    try {
      const stat = await Deno.stat(scenarioDeck.path);
      if (!stat.isFile) {
        throw new Error(
          `Scenario deck path is not a file: ${scenarioDeck.path}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.error(
        `[sim] workspaceScenarioRunStart deck preflight failed workspaceId=${args.workspaceId} deckId=${scenarioDeck.id} deckPath=${scenarioDeck.path} error=${message}`,
      );
      throw new Error(
        `Scenario deck is unavailable (${scenarioDeck.label}): ${message}`,
      );
    }
    const parseOptionalJsonInput = (
      value: unknown,
      label: string,
    ): unknown => {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== "string") return value;
      const text = value.trim();
      if (text.length === 0) return undefined;
      try {
        return JSON.parse(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid JSON";
        throw new Error(`${label} must be valid JSON: ${message}`);
      }
    };
    const parsedScenarioInput = parseOptionalJsonInput(
      args.scenarioInput,
      "scenarioInput",
    );
    const parsedAssistantInit = parseOptionalJsonInput(
      args.assistantInit,
      "assistantInit",
    );
    let assistantInit = parsedAssistantInit;
    if (assistantInit === undefined) {
      try {
        const desc = await deps.getSchemaPromise() as {
          defaults?: unknown;
          schema?: NormalizedSchema;
        };
        assistantInit = desc.defaults !== undefined
          ? cloneValue(desc.defaults)
          : deriveInitialFromSchema(desc.schema);
      } catch {
        // keep assistantInit undefined when schema introspection fails
      }
    }
    if (!requestedDeckId) {
      const startedAt = new Date().toISOString();
      const manualRun: TestBotRunStatus = {
        id: typeof args.runId === "string" && args.runId.trim().length > 0
          ? args.runId.trim()
          : deps.randomId("testbot"),
        status: "idle",
        workspaceId: args.workspaceId,
        sessionId: args.workspaceId,
        startedAt,
        messages: [],
        traces: [],
        toolInserts: [],
      };
      const existing = deps.readSessionState(args.workspaceId);
      const baseMeta = deps.buildWorkspaceMeta(
        workspaceRecord,
        existing?.meta as Record<string, unknown> | undefined,
      );
      const nextMeta = {
        ...baseMeta,
        testBot: true,
        testBotRunId: manualRun.id,
        testBotConfigPath: scenarioDeck.path,
        testBotName: path.basename(scenarioDeck.path).replace(
          /\.deck\.(md|ts)$/i,
          "",
        ),
        scenarioRunId: manualRun.id,
        selectedScenarioDeckId: scenarioDeck.id,
        selectedScenarioDeckLabel: "Manual assistant chat",
        scenarioConfigPath: scenarioDeck.path,
        scenarioRunMode: "manual",
        workspaceId: args.workspaceId,
      };
      const manualState = deps.persistSessionState({
        ...(existing ?? {
          runId: args.workspaceId,
          messages: [],
        }),
        runId: manualRun.id,
        messages: [],
        messageRefs: [],
        traces: [],
        items: [],
        meta: nextMeta,
      });
      testBotRuns.set(manualRun.id, {
        run: manualRun,
        state: manualState,
        promise: null,
        abort: null,
      });
      broadcastTestBot(
        { type: "testBotStatus", run: manualRun },
        args.workspaceId,
      );
      return {
        id: manualRun.id,
        workspaceId: args.workspaceId,
        status: manualRun.status,
        error: manualRun.error,
        startedAt: manualRun.startedAt,
        finishedAt: manualRun.finishedAt,
        messages: [],
        traces: [],
        toolInserts: [],
      };
    }
    const run = startTestBotRun({
      runId: args.runId,
      workspaceId: args.workspaceId,
      workspaceRecord,
      botDeckPath: scenarioDeck.path,
      botDeckId: scenarioDeck.id,
      botDeckLabel: scenarioDeck.label,
      maxTurnsOverride: scenarioDeck.maxTurns,
      botInput: parsedScenarioInput,
      deckInput: assistantInit,
      baseMeta: {
        scenarioRunMode: "scenario",
      },
    });
    return {
      id: run.id ?? deps.randomId("testbot"),
      workspaceId: args.workspaceId,
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      messages: Array.isArray(run.messages) ? [...run.messages] : [],
      traces: Array.isArray(run.traces) ? [...run.traces] : [],
      toolInserts: Array.isArray(run.toolInserts) ? [...run.toolInserts] : [],
    };
  };

  const sendWorkspaceScenarioRunForGraphql = async (args: {
    workspaceId: string;
    runId: string;
    message: string;
  }): Promise<TestBotRunStatus> => {
    await deps.activateWorkspaceDeck(args.workspaceId, { forceReload: true });
    const workspaceRecord = deps.resolveWorkspaceRecord(args.workspaceId);
    if (!workspaceRecord) {
      throw new Error("Workspace not found");
    }

    const active = testBotRuns.get(args.runId);
    if (
      active &&
      active.run.status === "running" &&
      (active.run.workspaceId === args.workspaceId ||
        active.run.sessionId === args.workspaceId)
    ) {
      throw new Error("Scenario run already in progress.");
    }

    const activeMatchesWorkspace = active
      ? (active.run.workspaceId === args.workspaceId ||
        active.run.sessionId === args.workspaceId)
      : false;
    let state: SavedState | undefined = activeMatchesWorkspace
      ? (active?.state ?? undefined)
      : undefined;
    if (!state) {
      try {
        state = deps.readSessionStateStrict(args.workspaceId, {
          withTraces: true,
        });
      } catch {
        state = undefined;
      }
    }
    if (!state) {
      throw new Error("Workspace state unavailable for scenario send.");
    }
    const stateMeta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    const stateRunId = typeof stateMeta.scenarioRunId === "string"
      ? stateMeta.scenarioRunId
      : typeof stateMeta.testBotRunId === "string"
      ? stateMeta.testBotRunId
      : null;
    if (stateRunId !== args.runId) {
      throw new Error(
        "Scenario run is not the active run state. Open latest run first.",
      );
    }

    const scenarioDeckPath = typeof stateMeta.scenarioConfigPath === "string"
      ? stateMeta.scenarioConfigPath
      : typeof stateMeta.testBotConfigPath === "string"
      ? stateMeta.testBotConfigPath
      : null;
    if (!scenarioDeckPath) {
      throw new Error("Scenario deck path unavailable for this run.");
    }

    const scenarioDeckId = typeof stateMeta.selectedScenarioDeckId === "string"
      ? stateMeta.selectedScenarioDeckId
      : undefined;
    const scenarioDeckLabel =
      typeof stateMeta.selectedScenarioDeckLabel === "string"
        ? stateMeta.selectedScenarioDeckLabel
        : undefined;
    const userMessageSource = stateMeta.scenarioRunMode === "manual"
      ? "manual"
      : "scenario";
    const runMaxTurns = typeof stateMeta.testBotMaxTurns === "number" &&
        Number.isFinite(stateMeta.testBotMaxTurns)
      ? Math.round(stateMeta.testBotMaxTurns)
      : undefined;
    const existingRun = active?.run;
    const run: TestBotRunStatus = {
      id: args.runId,
      status: "running",
      workspaceId: args.workspaceId,
      sessionId: args.workspaceId,
      startedAt: existingRun?.startedAt ??
        (typeof stateMeta.startedAt === "string"
          ? stateMeta.startedAt
          : null) ??
        new Date().toISOString(),
      finishedAt: undefined,
      error: undefined,
      maxTurns: existingRun?.maxTurns ?? runMaxTurns,
      messages: existingRun?.messages ? [...existingRun.messages] : [],
      traces: existingRun?.traces
        ? [...existingRun.traces]
        : Array.isArray(state.traces)
        ? [...state.traces]
        : [],
      toolInserts: existingRun?.toolInserts ? [...existingRun.toolInserts] : [],
      initFill:
        (stateMeta as { testBotInitFill?: TestBotInitFill }).testBotInitFill ??
          existingRun?.initFill,
    };

    const controller = new AbortController();
    const entry: TestBotRunEntry = {
      run,
      state,
      promise: null,
      abort: controller,
    };
    testBotRuns.set(args.runId, entry);

    const emitTestBot = (payload: unknown) =>
      broadcastTestBot(payload, args.workspaceId);
    const baseMeta = deps.buildWorkspaceMeta(workspaceRecord, stateMeta);
    let savedState: SavedState | undefined = state;
    const capturedTraces: Array<TraceEvent> = Array.isArray(state.traces)
      ? [...state.traces]
      : [];

    const appendFromState = (nextState: SavedState) => {
      const snapshot = buildTestBotSnapshot(nextState);
      run.messages = snapshot.messages;
      run.toolInserts = snapshot.toolInserts;
      run.traces = Array.isArray(nextState.traces)
        ? [...nextState.traces]
        : undefined;
      emitTestBot({ type: "testBotStatus", run });
    };

    const tracer = (event: TraceEvent) => {
      const stamped = event.ts ? event : { ...event, ts: Date.now() };
      capturedTraces.push(stamped);
      if (savedState) {
        deps.persistOpenResponsesTraceEvent(savedState, stamped, args.runId);
      }
      emitTestBot({
        type: "testBotTrace",
        workspaceId: args.workspaceId,
        runId: args.runId,
        event: stamped,
      });
    };

    const trimmedMessage = args.message.trim();
    const turn = run.messages.filter((message) => message.role === "user")
      .length;
    if (trimmedMessage.length > 0) {
      run.messages = [
        ...run.messages,
        { role: "user", content: trimmedMessage },
      ];
      deps.persistCanonicalUserInputEvent({
        state: savedState,
        runId: args.runId,
        message: trimmedMessage,
        source: "scenario",
      });
    }
    let hasStartedAssistantStreamMessage = false;
    entry.promise = (async () => {
      try {
        emitTestBot({ type: "testBotStatus", run });
        const rootResult = await runDeck({
          path: scenarioDeckPath,
          input: undefined,
          inputProvided: false,
          modelProvider: deps.modelProvider,
          defaultModel: deps.model,
          modelOverride: deps.modelForce,
          trace: tracer,
          stream: true,
          state: savedState,
          allowRootStringInput: true,
          initialUserMessage: trimmedMessage,
          responsesMode: deps.responsesMode,
          workerSandbox: resolveWorkerSandboxForSignalAwareRun({
            workerSandbox: deps.workerSandbox,
            signal: controller.signal,
          }),
          signal: controller.signal,
          onStateUpdate: (nextState) => {
            const sourced = applyUserMessageRefSource(
              savedState,
              nextState,
              userMessageSource,
            );
            const nextMeta = {
              ...baseMeta,
              ...(sourced.meta ?? {}),
              testBot: true,
              testBotRunId: args.runId,
              testBotConfigPath: scenarioDeckPath,
              testBotName: path.basename(scenarioDeckPath).replace(
                /\.deck\.(md|ts)$/i,
                "",
              ),
              scenarioRunId: args.runId,
              ...(scenarioDeckId
                ? { selectedScenarioDeckId: scenarioDeckId }
                : {}),
              ...(scenarioDeckLabel
                ? { selectedScenarioDeckLabel: scenarioDeckLabel }
                : {}),
              scenarioConfigPath: scenarioDeckPath,
              scenarioRunMode: userMessageSource === "manual"
                ? "manual"
                : "scenario",
              ...(run.initFill ? { testBotInitFill: run.initFill } : {}),
              workspaceId: args.workspaceId,
              ...(run.maxTurns ? { testBotMaxTurns: run.maxTurns } : {}),
            };
            const enriched = deps.persistSessionState({
              ...sourced,
              meta: nextMeta,
              traces: capturedTraces,
            });
            savedState = enriched;
            entry.state = enriched;
            appendFromState(enriched);
          },
          onStreamText: (chunk) => {
            if (typeof chunk === "string" && chunk.length > 0) {
              if (!hasStartedAssistantStreamMessage) {
                run.messages = [
                  ...run.messages,
                  { role: "assistant", content: chunk },
                ];
                hasStartedAssistantStreamMessage = true;
              } else {
                const last = run.messages[run.messages.length - 1];
                if (last?.role === "assistant") {
                  last.content += chunk;
                }
              }
            }
            emitTestBot({
              type: "testBotStream",
              workspaceId: args.workspaceId,
              runId: args.runId,
              role: "assistant",
              chunk,
              turn,
              ts: Date.now(),
            });
          },
        });
        if (!isGambitEndSignal(rootResult)) {
          emitTestBot({
            type: "testBotStreamEnd",
            workspaceId: args.workspaceId,
            runId: args.runId,
            role: "assistant",
            turn,
            ts: Date.now(),
          });
        }
        run.status = controller.signal.aborted ? "canceled" : "completed";
        run.error = undefined;
      } catch (err) {
        if (controller.signal.aborted || isRunCanceledError(err)) {
          run.status = "canceled";
          run.error = undefined;
        } else {
          run.status = "error";
          run.error = err instanceof Error ? err.message : String(err);
        }
      } finally {
        if (savedState?.messages) {
          const snapshot = buildTestBotSnapshot(savedState);
          run.messages = snapshot.messages;
          run.toolInserts = snapshot.toolInserts;
          run.traces = Array.isArray(savedState.traces)
            ? [...savedState.traces]
            : run.traces;
        }
        if (savedState) {
          entry.state = savedState;
        }
        run.finishedAt = new Date().toISOString();
        entry.abort = null;
        entry.promise = null;
        emitTestBot({ type: "testBotStatus", run });
      }
    })();

    return {
      id: run.id,
      workspaceId: args.workspaceId,
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      messages: Array.isArray(run.messages) ? [...run.messages] : [],
      traces: Array.isArray(run.traces) ? [...run.traces] : [],
      toolInserts: Array.isArray(run.toolInserts) ? [...run.toolInserts] : [],
    };
  };

  const readWorkspaceScenarioRunsForGraphql = (
    workspaceId: string,
  ): Array<TestBotRunStatus> => {
    const latestByRunId = new Map<string, TestBotRunStatus>();
    const persistedState = deps.readSessionState(workspaceId);
    if (persistedState) {
      const metaRuns = listScenarioRunStatusesFromStateMeta(
        persistedState,
        workspaceId,
      );
      if (metaRuns.length > 0) {
        for (const run of metaRuns) {
          latestByRunId.set(run.id, run);
        }
      } else {
        for (
          const run of listPersistedTestRunStatuses(persistedState, workspaceId)
        ) {
          latestByRunId.set(run.id, run);
        }
      }
    }
    for (const entry of testBotRuns.values()) {
      const run = entry.run;
      if (
        run.workspaceId !== workspaceId &&
        run.sessionId !== workspaceId
      ) {
        continue;
      }
      if (!run.id || run.id.trim().length === 0) continue;
      latestByRunId.set(run.id, run);
    }
    const records = [...latestByRunId.values()].map((run) => ({
      id: run.id,
      workspaceId,
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      messages: Array.isArray(run.messages) ? [...run.messages] : [],
      traces: Array.isArray(run.traces) ? [...run.traces] : [],
      toolInserts: Array.isArray(run.toolInserts) ? [...run.toolInserts] : [],
      maxTurns: run.maxTurns,
      initFill: run.initFill,
      sessionId: run.sessionId,
    }));
    records.sort((a, b) => {
      const aKey = a.startedAt ?? a.finishedAt ?? a.id;
      const bKey = b.startedAt ?? b.finishedAt ?? b.id;
      return bKey.localeCompare(aKey);
    });
    return records;
  };

  const stopWorkspaceScenarioRunForGraphql = async (args: {
    workspaceId: string;
    runId: string;
  }): Promise<TestBotRunStatus> => {
    const active = testBotRuns.get(args.runId);
    if (
      active &&
      (active.run.workspaceId === args.workspaceId ||
        active.run.sessionId === args.workspaceId)
    ) {
      active.abort?.abort();
      try {
        await active.promise;
      } catch {
        // Abort path can reject internally; run projection remains authoritative.
      }
    }

    const latest = readWorkspaceScenarioRunsForGraphql(args.workspaceId).find(
      (run) => run.id === args.runId,
    );
    if (latest) return latest;
    throw new Error(`Scenario run ${args.runId} not found`);
  };

  const readWorkspaceScenarioRunForGraphql = (
    workspaceId: string,
    runId: string,
  ): TestBotRunStatus | undefined => {
    return readWorkspaceScenarioRunsForGraphql(workspaceId).find((run) =>
      run.id === runId
    );
  };

  return {
    broadcastTestBot,
    startWorkspaceScenarioRunForGraphql,
    sendWorkspaceScenarioRunForGraphql,
    readWorkspaceScenarioRunsForGraphql,
    readWorkspaceScenarioRunForGraphql,
    stopWorkspaceScenarioRunForGraphql,
    getLiveTestRunEntry: (runId: string) => testBotRuns.get(runId),
    getLiveTestRunEntryByWorkspaceId: findTestRunByWorkspaceId,
    readPersistedTestRunStatusById,
    isFeedbackEligibleMessageRef,
    isFeedbackEligiblePersistedTestRunMessageRef,
    syncTestBotRunFromState,
  };
};
