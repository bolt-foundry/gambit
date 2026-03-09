import { isRunCanceledError, runDeck } from "@bolt-foundry/gambit-core";
import type {
  ModelProvider,
  SavedState,
  TraceEvent,
} from "@bolt-foundry/gambit-core";
import type { BuildChatProvider } from "../../server_build_chat_provider.ts";
import { buildTestBotSnapshot } from "./helpers.ts";
import type {
  BuildBotRunEntry,
  BuildBotRunStatus,
  WorkspaceRunToolInsert,
} from "./types.ts";
import { resolveWorkerSandboxForSignalAwareRun } from "./run_deck.ts";

export const createWorkspaceBuildService = (deps: {
  buildAssistantDeckPath: string;
  initialContext: unknown;
  hasInitialContext: boolean;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  responsesMode?: boolean;
  workerSandbox?: boolean;
  randomId: (prefix: string) => string;
  readSessionState: (workspaceId: string) => SavedState | undefined;
  readSessionStateStrict: (
    workspaceId: string,
    options?: { withTraces?: boolean },
  ) => SavedState | undefined;
  readBuildState: (workspaceId: string) =>
    | {
      run?: {
        id?: string;
        status: BuildBotRunStatus["status"];
        error?: string;
        startedAt?: string;
        finishedAt?: string;
        messages?: Array<BuildBotRunStatus["messages"][number]>;
        traces?: Array<TraceEvent>;
        toolInserts?: Array<WorkspaceRunToolInsert>;
      };
      state?: SavedState;
    }
    | null
    | undefined;
  appendWorkspaceEnvelope: (
    state: SavedState,
    domain: "build",
    payload: Record<string, unknown>,
  ) => void;
  appendDurableStreamEvent: (streamId: string, payload: unknown) => void;
  workspaceStreamId: string;
  persistCanonicalUserInputEvent: (args: {
    state: SavedState | null | undefined;
    runId: string;
    message: string;
    source: "build" | "scenario";
  }) => void;
  persistOpenResponsesTracesFromState: (
    state: SavedState | null | undefined,
    fallbackRunId?: string,
  ) => void;
  persistOpenResponsesTraceEvent: (
    state: SavedState | null | undefined,
    trace: TraceEvent,
    fallbackRunId?: string,
  ) => void;
}) => {
  const buildBotRuns = new Map<string, BuildBotRunEntry>();

  const ensureWorkspaceStateForBuild = (workspaceId: string): SavedState => {
    const state = deps.readSessionStateStrict(workspaceId, {
      withTraces: true,
    });
    if (!state) {
      throw new Error("Workspace not found");
    }
    return state;
  };

  const buildAuthorityMeta = (
    sessionState: SavedState,
    workspaceId: string,
  ): Record<string, unknown> => {
    const sessionMeta =
      sessionState.meta && typeof sessionState.meta === "object"
        ? sessionState.meta as Record<string, unknown>
        : {};
    const next: Record<string, unknown> = { workspaceId };
    for (
      const key of [
        "sessionId",
        "sessionDir",
        "sessionStatePath",
        "sessionEventsPath",
        "sessionBuildStatePath",
        "sessionSqlitePath",
        "workspaceSchemaVersion",
      ]
    ) {
      const value = sessionMeta[key];
      if (typeof value === "string" && value.trim().length > 0) {
        next[key] = value;
      }
    }
    return next;
  };

  const normalizeBuildAuthorityState = (args: {
    state: SavedState;
    workspaceId: string;
    runId: string;
    sessionState: SavedState;
  }): SavedState => ({
    ...args.state,
    runId: args.runId,
    meta: {
      ...(args.state.meta ?? {}),
      ...buildAuthorityMeta(args.sessionState, args.workspaceId),
    },
  });

  const broadcastBuild = (
    workspaceId: string,
    payload: Record<string, unknown>,
  ) => {
    const state = deps.readSessionState(workspaceId);
    if (state) {
      deps.appendWorkspaceEnvelope(state, "build", payload);
    }
    deps.appendDurableStreamEvent(deps.workspaceStreamId, payload);
  };

  const buildRunFromProjection = (workspaceId: string): BuildBotRunStatus => {
    const projection = deps.readBuildState(workspaceId);
    const run = projection?.run;
    if (!run) {
      return {
        id: workspaceId,
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      };
    }
    return {
      id: run.id || workspaceId,
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      messages: Array.isArray(run.messages) ? run.messages : [],
      traces: Array.isArray(run.traces) ? run.traces : [],
      toolInserts: Array.isArray(run.toolInserts) ? run.toolInserts : [],
    };
  };

  const readWorkspaceBuildRunForGraphql = (
    workspaceId: string,
  ): BuildBotRunStatus => {
    const active = buildBotRuns.get(workspaceId)?.run;
    if (active) {
      return {
        ...active,
        messages: Array.isArray(active.messages) ? [...active.messages] : [],
        traces: Array.isArray(active.traces) ? [...active.traces] : [],
        toolInserts: Array.isArray(active.toolInserts)
          ? [...active.toolInserts]
          : [],
      };
    }
    return buildRunFromProjection(workspaceId);
  };

  const startWorkspaceBuildRun = (args: {
    workspaceId: string;
    message: string;
    buildChatProvider?: BuildChatProvider;
  }): BuildBotRunStatus => {
    const workspaceId = args.workspaceId;
    const active = buildBotRuns.get(workspaceId);
    if (active?.run.status === "running") {
      throw new Error("Build run already in progress for this workspace.");
    }

    const sessionState = ensureWorkspaceStateForBuild(workspaceId);
    const projection = deps.readBuildState(workspaceId);
    const seedRun = projection?.run;
    const runId = seedRun?.id && seedRun.id.trim().length > 0
      ? seedRun.id
      : deps.randomId("build");
    const seededMessages = (() => {
      if (
        projection?.state?.messages && Array.isArray(projection.state.messages)
      ) {
        return projection.state.messages;
      }
      return Array.isArray(seedRun?.messages)
        ? seedRun.messages.map((message) => {
          const role: "assistant" | "user" | "system" | "tool" =
            message.role === "assistant" || message.role === "system" ||
              message.role === "tool"
              ? message.role
              : "user";
          return {
            role,
            content: message.content,
          };
        })
        : [];
    })();
    const seedState = normalizeBuildAuthorityState({
      state: projection?.state && typeof projection.state === "object"
        ? projection.state
        : {
          runId,
          messages: seededMessages,
          messageRefs: [],
          traces: Array.isArray(seedRun?.traces) ? [...seedRun.traces] : [],
          items: [],
          meta: {},
        },
      workspaceId,
      runId,
      sessionState,
    });
    const trimmedMessage = args.message.trim();
    const run: BuildBotRunStatus = {
      id: runId,
      status: "running",
      startedAt: new Date().toISOString(),
      error: undefined,
      finishedAt: undefined,
      messages: Array.isArray(seedRun?.messages) ? [...seedRun.messages] : [],
      traces: Array.isArray(seedRun?.traces) ? [...seedRun.traces] : [],
      toolInserts: Array.isArray(seedRun?.toolInserts)
        ? [...seedRun.toolInserts]
        : [],
    };
    if (trimmedMessage.length > 0) {
      run.messages = [
        ...run.messages,
        { role: "user", content: trimmedMessage, messageSource: "manual" },
      ];
      deps.persistCanonicalUserInputEvent({
        state: sessionState,
        runId,
        message: trimmedMessage,
        source: "build",
      });
    }

    const controller = new AbortController();
    const entry: BuildBotRunEntry = {
      run,
      state: seedState,
      promise: null,
      abort: controller,
    };
    buildBotRuns.set(workspaceId, entry);

    const onStateUpdate = (next: SavedState) => {
      const buildState = normalizeBuildAuthorityState({
        state: next,
        workspaceId,
        runId,
        sessionState,
      });
      deps.persistOpenResponsesTracesFromState(buildState, runId);
      entry.state = buildState;
      const snapshot = buildTestBotSnapshot(buildState);
      run.messages = snapshot.messages;
      run.toolInserts = snapshot.toolInserts;
      const nextTraces = Array.isArray(buildState.traces)
        ? [...buildState.traces]
        : [];
      if (nextTraces.length > 0) {
        run.traces = nextTraces;
      } else if (!Array.isArray(run.traces)) {
        run.traces = [];
      }
      broadcastBuild(workspaceId, {
        type: "buildBotStatus",
        workspaceId,
        run,
        state: buildState,
      });
    };

    const tracer = (trace: TraceEvent) => {
      const event = trace.ts ? trace : { ...trace, ts: Date.now() };
      const currentTraces = Array.isArray(run.traces) ? run.traces : [];
      run.traces = [...currentTraces, event];
      deps.persistOpenResponsesTraceEvent(entry.state, event, runId);
      broadcastBuild(workspaceId, {
        type: "buildBotTrace",
        workspaceId,
        runId,
        event,
      });
    };

    const turn = run.messages.filter((message) => message.role === "user")
      .length;
    let hasStartedAssistantStreamMessage = false;
    entry.promise = (async () => {
      try {
        broadcastBuild(workspaceId, {
          type: "buildBotStatus",
          workspaceId,
          run,
          state: entry.state ?? undefined,
        });
        await runDeck({
          path: deps.buildAssistantDeckPath,
          input: deps.initialContext,
          inputProvided: deps.hasInitialContext,
          modelProvider: deps.modelProvider,
          defaultModel: deps.model,
          modelOverride: deps.modelForce ??
            (!deps.model && args.buildChatProvider
              ? `${args.buildChatProvider}/default`
              : undefined),
          trace: tracer,
          stream: true,
          runId,
          state: entry.state ?? undefined,
          allowRootStringInput: true,
          initialUserMessage: trimmedMessage.length > 0 ? trimmedMessage : "",
          responsesMode: deps.responsesMode,
          workerSandbox: resolveWorkerSandboxForSignalAwareRun({
            workerSandbox: deps.workerSandbox,
            signal: controller.signal,
          }),
          signal: controller.signal,
          onStateUpdate,
          onStreamText: (chunk) => {
            if (typeof chunk === "string" && chunk.length > 0) {
              if (!hasStartedAssistantStreamMessage) {
                run.messages = [
                  ...run.messages,
                  {
                    role: "assistant",
                    content: chunk,
                  },
                ];
                hasStartedAssistantStreamMessage = true;
              } else {
                const last = run.messages[run.messages.length - 1];
                if (last?.role === "assistant") {
                  last.content += chunk;
                } else {
                  run.messages = [
                    ...run.messages,
                    {
                      role: "assistant",
                      content: chunk,
                    },
                  ];
                }
              }
            }
            broadcastBuild(workspaceId, {
              type: "buildBotStream",
              workspaceId,
              runId,
              role: "assistant",
              chunk,
              turn,
              ts: Date.now(),
            });
          },
        });
        broadcastBuild(workspaceId, {
          type: "buildBotStreamEnd",
          workspaceId,
          runId,
          role: "assistant",
          turn,
          ts: Date.now(),
        });
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
        run.finishedAt = new Date().toISOString();
        entry.abort = null;
        entry.promise = null;
        broadcastBuild(workspaceId, {
          type: "buildBotStatus",
          workspaceId,
          run,
          state: entry.state ?? undefined,
        });
      }
    })();

    return run;
  };

  const stopWorkspaceBuildRun = async (args: {
    workspaceId: string;
    runId: string;
  }): Promise<BuildBotRunStatus> => {
    const active = buildBotRuns.get(args.workspaceId);
    if (!active || active.run.id !== args.runId) {
      return buildRunFromProjection(args.workspaceId);
    }
    active.abort?.abort();
    try {
      await active.promise;
    } catch {
      // Abort path can reject internally; projection is still authoritative.
    }
    return buildRunFromProjection(args.workspaceId);
  };

  const resetWorkspaceBuild = async (
    workspaceId: string,
  ): Promise<BuildBotRunStatus> => {
    const active = buildBotRuns.get(workspaceId);
    active?.abort?.abort();
    try {
      await active?.promise;
    } catch {
      // Ignore aborted in-flight run.
    }

    const run: BuildBotRunStatus = {
      id: deps.randomId("build"),
      status: "idle",
      messages: [],
      traces: [],
      toolInserts: [],
    };
    const sessionState = ensureWorkspaceStateForBuild(workspaceId);
    const reset = normalizeBuildAuthorityState({
      state: {
        runId: run.id,
        messages: [],
        messageRefs: [],
        traces: [],
        items: [],
      },
      workspaceId,
      runId: run.id,
      sessionState,
    });
    deps.appendWorkspaceEnvelope(sessionState, "build", {
      type: "buildBotStatus",
      workspaceId,
      run,
      state: reset,
    });
    deps.appendDurableStreamEvent(deps.workspaceStreamId, {
      type: "buildBotStatus",
      workspaceId,
      run,
    });
    return buildRunFromProjection(workspaceId);
  };

  return {
    startWorkspaceBuildRun,
    stopWorkspaceBuildRun,
    resetWorkspaceBuild,
    readWorkspaceBuildRunForGraphql,
    buildRunFromProjection,
    getLiveBuildRunEntry: (workspaceId: string) =>
      buildBotRuns.get(workspaceId),
  };
};
