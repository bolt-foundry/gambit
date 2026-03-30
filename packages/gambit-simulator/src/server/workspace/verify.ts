import type { SavedState } from "@bolt-foundry/gambit-core";
import type { WorkspaceDeckState } from "../../server_types.ts";
import type {
  TestBotRunEntry,
  TestBotRunStatus,
  WorkspaceGradeRunForGraphql,
  WorkspaceVerifyBatchRecordForGraphql,
  WorkspaceVerifyBatchRequestRecordForGraphql,
} from "./types.ts";

export const createWorkspaceVerifyService = (deps: {
  randomId: (prefix: string) => string;
  verifyScenarioRunsMax: number;
  verifyGraderRepeatsMax: number;
  verifyBatchConcurrencyMax: number;
  defaultVerifyScenarioRuns: number;
  defaultVerifyGraderRepeats: number;
  defaultVerifyConcurrency: number;
  appendDurableStreamEvent: (streamId: string, payload: unknown) => void;
  workspaceStreamId: string;
  activateWorkspaceDeck: (
    workspaceId?: string | null,
    options?: {
      forceReload?: boolean;
      source?: string;
      reloadAttemptId?: string;
    },
  ) => Promise<void>;
  readWorkspaceDeckStateStrict: (workspaceId: string) => WorkspaceDeckState;
  resolveGraderDeckFromState: (
    deckState: WorkspaceDeckState,
    graderId: string,
  ) => WorkspaceDeckState["graderDecks"][number] | undefined;
  readSessionState: (workspaceId: string) => SavedState | undefined;
  readSessionStateStrict: (
    workspaceId: string,
    options?: { withTraces?: boolean },
  ) => SavedState | undefined;
  persistSessionState: (state: SavedState) => SavedState;
  appendGradingLog: (
    state: SavedState,
    payload: Record<string, unknown>,
  ) => void;
  startWorkspaceScenarioRunForGraphql: (args: {
    workspaceId: string;
    runId?: string;
    scenarioDeckId?: string | null;
    scenarioInput?: unknown;
    assistantInit?: unknown;
  }) => Promise<TestBotRunStatus>;
  readWorkspaceScenarioRunsForGraphql: (
    workspaceId: string,
  ) => Array<TestBotRunStatus>;
  getLiveTestRunEntry: (runId: string) => TestBotRunEntry | undefined;
  createWorkspaceGradeRunForGraphql: (args: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: string | null;
  }) => Promise<WorkspaceGradeRunForGraphql>;
}) => {
  const normalizeVerifyBatchStatus = (
    value: unknown,
  ): WorkspaceVerifyBatchRecordForGraphql["status"] => {
    if (value === "running") return "running";
    if (value === "completed") return "completed";
    if (value === "error") return "error";
    return "idle";
  };

  const normalizeVerifyBatchRequestStatus = (
    value: unknown,
  ): WorkspaceVerifyBatchRequestRecordForGraphql["status"] => {
    if (value === "running") return "running";
    if (value === "completed") return "completed";
    if (value === "error") return "error";
    return "queued";
  };

  const readWorkspaceVerifyBatchesFromState = (
    state: SavedState,
  ): Array<WorkspaceVerifyBatchRecordForGraphql> => {
    const meta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    if (!Array.isArray(meta.verifyBatches)) return [];
    return meta.verifyBatches.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const batch = entry as Record<string, unknown>;
      if (typeof batch.graderId !== "string" || batch.graderId.trim() === "") {
        return [];
      }
      const requests = Array.isArray(batch.requests)
        ? batch.requests.flatMap((request, requestIndex) => {
          if (!request || typeof request !== "object") return [];
          const requestRecord = request as Record<string, unknown>;
          const requestId = typeof requestRecord.id === "string" &&
              requestRecord.id.trim().length > 0
            ? requestRecord.id
            : `${String(batch.id ?? deps.randomId("vbatch"))}:${
              requestIndex + 1
            }`;
          const runId = typeof requestRecord.runId === "string" &&
              requestRecord.runId.trim().length > 0
            ? requestRecord.runId
            : undefined;
          const scenarioRunId =
            typeof requestRecord.scenarioRunId === "string" &&
              requestRecord.scenarioRunId.trim().length > 0
              ? requestRecord.scenarioRunId
              : undefined;
          const error = typeof requestRecord.error === "string" &&
              requestRecord.error.trim().length > 0
            ? requestRecord.error
            : undefined;
          return [{
            id: requestId,
            status: normalizeVerifyBatchRequestStatus(requestRecord.status),
            scenarioRunId,
            runId,
            error,
          }];
        })
        : [];
      const active = requests.filter((request) => request.status === "running")
        .length;
      const completed = requests.filter((request) =>
        request.status === "completed"
      ).length;
      const failed = requests.filter((request) => request.status === "error")
        .length;
      const requested = Math.max(
        requests.length,
        typeof batch.requested === "number" && Number.isFinite(batch.requested)
          ? Math.max(0, Math.round(batch.requested))
          : 0,
      );
      return [{
        id: typeof batch.id === "string" && batch.id.trim().length > 0
          ? batch.id
          : deps.randomId("vbatch"),
        workspaceId:
          typeof batch.workspaceId === "string" && batch.workspaceId.trim()
            ? batch.workspaceId
            : "",
        scenarioDeckId: typeof batch.scenarioDeckId === "string" &&
            batch.scenarioDeckId.trim().length > 0
          ? batch.scenarioDeckId
          : undefined,
        graderId: batch.graderId,
        scenarioRuns: typeof batch.scenarioRuns === "number" &&
            Number.isFinite(batch.scenarioRuns)
          ? Math.max(0, Math.round(batch.scenarioRuns))
          : 0,
        graderRepeatsPerScenario:
          typeof batch.graderRepeatsPerScenario === "number" &&
            Number.isFinite(batch.graderRepeatsPerScenario)
            ? Math.max(0, Math.round(batch.graderRepeatsPerScenario))
            : 0,
        status: normalizeVerifyBatchStatus(batch.status),
        startedAt:
          typeof batch.startedAt === "string" && batch.startedAt.trim().length >
              0
            ? batch.startedAt
            : undefined,
        finishedAt: typeof batch.finishedAt === "string" &&
            batch.finishedAt.trim().length > 0
          ? batch.finishedAt
          : undefined,
        requested,
        active,
        completed,
        failed,
        scenarioRunsCompleted:
          typeof batch.scenarioRunsCompleted === "number" &&
            Number.isFinite(batch.scenarioRunsCompleted)
            ? Math.max(0, Math.round(batch.scenarioRunsCompleted))
            : 0,
        scenarioRunsFailed: typeof batch.scenarioRunsFailed === "number" &&
            Number.isFinite(batch.scenarioRunsFailed)
          ? Math.max(0, Math.round(batch.scenarioRunsFailed))
          : 0,
        requests,
      }];
    });
  };

  const writeWorkspaceVerifyBatchesToState = (
    state: SavedState,
    batches: Array<WorkspaceVerifyBatchRecordForGraphql>,
  ): SavedState => {
    const currentMeta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    return {
      ...state,
      meta: {
        ...currentMeta,
        verifyBatches: batches,
      },
    };
  };

  const upsertWorkspaceVerifyBatchInState = (
    state: SavedState,
    nextBatch: WorkspaceVerifyBatchRecordForGraphql,
  ): SavedState => {
    const existing = readWorkspaceVerifyBatchesFromState(state);
    const nextBatches = [...existing];
    const existingIndex = nextBatches.findIndex((entry) =>
      entry.id === nextBatch.id
    );
    if (existingIndex >= 0) {
      nextBatches[existingIndex] = nextBatch;
    } else {
      nextBatches.unshift(nextBatch);
    }
    return writeWorkspaceVerifyBatchesToState(
      state,
      nextBatches.slice(0, 50),
    );
  };

  const emitVerifyWorkspaceEvent = (
    workspaceId: string,
    payload: Record<string, unknown>,
  ) => {
    deps.appendDurableStreamEvent(deps.workspaceStreamId, {
      ...payload,
      workspaceId,
    });
  };

  const readWorkspaceVerifyBatchesForGraphql = (
    workspaceId: string,
  ): Array<WorkspaceVerifyBatchRecordForGraphql> => {
    const state = deps.readSessionState(workspaceId);
    if (!state) return [];
    return readWorkspaceVerifyBatchesFromState(state).map((batch) => ({
      ...batch,
      workspaceId,
    }));
  };

  const createWorkspaceVerifyBatchRunForGraphql = async (args: {
    workspaceId: string;
    scenarioDeckId?: string | null;
    graderId: string;
    scenarioRuns: number;
    graderRepeatsPerScenario: number;
    concurrency: number;
  }): Promise<WorkspaceVerifyBatchRecordForGraphql> => {
    await deps.activateWorkspaceDeck(args.workspaceId, {
      source: "graphql:createWorkspaceVerifyBatchRun",
    });
    const deckState = deps.readWorkspaceDeckStateStrict(args.workspaceId);
    const grader = deps.resolveGraderDeckFromState(deckState, args.graderId);
    if (!grader) {
      throw new Error(`Unknown grader deck: ${args.graderId}`);
    }

    const state = deps.readSessionStateStrict(args.workspaceId, {
      withTraces: true,
    });
    if (!state) {
      throw new Error(`Workspace ${args.workspaceId} not found`);
    }

    const selectedScenarioDeckId = typeof args.scenarioDeckId === "string" &&
        args.scenarioDeckId.trim().length > 0
      ? args.scenarioDeckId.trim()
      : undefined;
    const normalizedScenarioRuns = Math.max(
      1,
      Math.min(
        deps.verifyScenarioRunsMax,
        Number.isFinite(args.scenarioRuns)
          ? Math.round(args.scenarioRuns)
          : deps.defaultVerifyScenarioRuns,
      ),
    );
    const normalizedRepeats = Math.max(
      1,
      Math.min(
        deps.verifyGraderRepeatsMax,
        Number.isFinite(args.graderRepeatsPerScenario)
          ? Math.round(args.graderRepeatsPerScenario)
          : deps.defaultVerifyGraderRepeats,
      ),
    );
    const requestedSamples = normalizedScenarioRuns * normalizedRepeats;
    const normalizedConcurrency = Math.max(
      1,
      Math.min(
        deps.verifyBatchConcurrencyMax,
        requestedSamples,
        Number.isFinite(args.concurrency)
          ? Math.round(args.concurrency)
          : deps.defaultVerifyConcurrency,
      ),
    );

    const now = new Date().toISOString();
    const batchId = deps.randomId("vbatch");
    let batch: WorkspaceVerifyBatchRecordForGraphql = {
      id: batchId,
      workspaceId: args.workspaceId,
      scenarioDeckId: selectedScenarioDeckId,
      graderId: grader.id,
      scenarioRuns: normalizedScenarioRuns,
      graderRepeatsPerScenario: normalizedRepeats,
      status: "running",
      startedAt: now,
      finishedAt: undefined,
      requested: requestedSamples,
      active: 0,
      completed: 0,
      failed: 0,
      scenarioRunsCompleted: 0,
      scenarioRunsFailed: 0,
      requests: Array.from(
        { length: normalizedScenarioRuns },
        (_value, scenarioIndex) =>
          Array.from({ length: normalizedRepeats }, (_repeat, repeatIndex) => ({
            id: `${batchId}:s${scenarioIndex + 1}:r${repeatIndex + 1}`,
            status: "queued" as const,
          })),
      ).flat(),
    };

    const recomputeBatchState = (
      baseBatch: WorkspaceVerifyBatchRecordForGraphql,
      nextRequests: Array<WorkspaceVerifyBatchRequestRecordForGraphql>,
      options?: {
        scenarioRunsCompleted?: number;
        scenarioRunsFailed?: number;
      },
    ): WorkspaceVerifyBatchRecordForGraphql => {
      const active =
        nextRequests.filter((request) => request.status === "running").length;
      const completed =
        nextRequests.filter((request) => request.status === "completed").length;
      const failed =
        nextRequests.filter((request) => request.status === "error")
          .length;
      const terminal = completed + failed === requestedSamples && active === 0;
      return {
        ...baseBatch,
        requests: nextRequests,
        active,
        completed,
        failed,
        scenarioRunsCompleted: options?.scenarioRunsCompleted ??
          baseBatch.scenarioRunsCompleted,
        scenarioRunsFailed: options?.scenarioRunsFailed ??
          baseBatch.scenarioRunsFailed,
        status: terminal ? (failed > 0 ? "error" : "completed") : "running",
        finishedAt: terminal ? new Date().toISOString() : undefined,
      };
    };
    const awaitScenarioRunTerminal = async (
      run: TestBotRunStatus,
    ): Promise<TestBotRunStatus> => {
      if (run.status !== "running" && run.status !== "idle") {
        return run;
      }
      const active = deps.getLiveTestRunEntry(run.id);
      if (active?.promise) {
        try {
          await active.promise;
        } catch {
          // Run status/error is projected on the run record.
        }
      }
      const latest = deps.readWorkspaceScenarioRunsForGraphql(args.workspaceId)
        .find((entry) => entry.id === run.id);
      return latest ?? run;
    };

    let persistedState = deps.persistSessionState(
      upsertWorkspaceVerifyBatchInState(state, batch),
    );
    const persistAndBroadcastBatch = (reason: string) => {
      const latest = deps.readSessionStateStrict(args.workspaceId, {
        withTraces: true,
      }) ?? persistedState;
      persistedState = deps.persistSessionState(
        upsertWorkspaceVerifyBatchInState(latest, batch),
      );
      deps.appendGradingLog(persistedState, {
        type: "gambit.verify.batch",
        workspaceId: args.workspaceId,
        reason,
        batch,
      });
      emitVerifyWorkspaceEvent(args.workspaceId, {
        type: "gambit.verify.batch",
        reason,
        batch,
      });
    };
    persistAndBroadcastBatch("created");

    let updateQueue = Promise.resolve();
    const queueBatchUpdate = async (
      reason: string,
      updater: (
        current: WorkspaceVerifyBatchRecordForGraphql,
      ) => WorkspaceVerifyBatchRecordForGraphql,
    ) => {
      updateQueue = updateQueue.then(() => {
        batch = updater(batch);
        persistAndBroadcastBatch(reason);
      });
      await updateQueue;
    };
    const updateBatchRequest = async (
      requestIndex: number,
      patch: Partial<WorkspaceVerifyBatchRequestRecordForGraphql>,
    ) => {
      await queueBatchUpdate("request-update", (current) => {
        if (requestIndex < 0 || requestIndex >= current.requests.length) {
          return current;
        }
        const nextRequests = current.requests.map((request, index) =>
          index === requestIndex ? { ...request, ...patch } : request
        );
        const active = nextRequests.filter((request) =>
          request.status === "running"
        ).length;
        const completed =
          nextRequests.filter((request) => request.status === "completed")
            .length;
        const failed =
          nextRequests.filter((request) => request.status === "error").length;
        const terminal = completed + failed === current.requested &&
          active === 0;
        return {
          ...current,
          requests: nextRequests,
          active,
          completed,
          failed,
          status: terminal ? (failed > 0 ? "error" : "completed") : "running",
          finishedAt: terminal ? new Date().toISOString() : undefined,
        };
      });
    };
    const queuedGradeRequestIndexes: Array<number> = [];
    let gradeQueueClosed = false;
    const gradeQueueWaiters: Array<() => void> = [];
    const wakeGradeWorkers = (count: number) => {
      let remaining = Math.max(0, count);
      while (remaining > 0 && gradeQueueWaiters.length > 0) {
        const notify = gradeQueueWaiters.shift();
        if (notify) notify();
        remaining -= 1;
      }
    };
    const enqueueGradeRequestIndexes = (requestIndexes: Array<number>) => {
      if (requestIndexes.length === 0) return;
      queuedGradeRequestIndexes.push(...requestIndexes);
      wakeGradeWorkers(requestIndexes.length);
    };
    const closeGradeQueue = () => {
      gradeQueueClosed = true;
      while (gradeQueueWaiters.length > 0) {
        const notify = gradeQueueWaiters.shift();
        if (notify) notify();
      }
    };
    const nextQueuedGradeRequestIndex = async (): Promise<
      number | undefined
    > => {
      while (queuedGradeRequestIndexes.length === 0) {
        if (gradeQueueClosed) return undefined;
        await new Promise<void>((resolve) => {
          gradeQueueWaiters.push(resolve);
        });
      }
      return queuedGradeRequestIndexes.shift();
    };
    const gradeWorkers = Array.from(
      { length: normalizedConcurrency },
      () =>
        (async () => {
          while (true) {
            const requestIndex = await nextQueuedGradeRequestIndex();
            if (requestIndex === undefined) return;
            const scenarioRunId = batch.requests[requestIndex]?.scenarioRunId;
            if (!scenarioRunId) continue;
            await updateBatchRequest(requestIndex, { status: "running" });
            try {
              const run = await deps.createWorkspaceGradeRunForGraphql({
                workspaceId: args.workspaceId,
                graderId: grader.id,
                scenarioRunId,
              });
              if (run.status === "completed") {
                await updateBatchRequest(requestIndex, {
                  status: "completed",
                  scenarioRunId,
                  runId: run.id,
                  error: undefined,
                });
              } else {
                await updateBatchRequest(requestIndex, {
                  status: "error",
                  scenarioRunId,
                  runId: run.id,
                  error: run.error ??
                    `Grade run ended with status ${run.status}`,
                });
              }
            } catch (error) {
              await updateBatchRequest(requestIndex, {
                status: "error",
                scenarioRunId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        })(),
    );

    let scenarioCursor = 0;
    const nextScenarioIndex = (): number | undefined => {
      if (scenarioCursor >= normalizedScenarioRuns) return undefined;
      const current = scenarioCursor;
      scenarioCursor += 1;
      return current;
    };
    const scenarioWorkerCount = Math.max(
      1,
      Math.min(normalizedScenarioRuns, normalizedConcurrency),
    );
    const scenarioWorkers = Array.from(
      { length: scenarioWorkerCount },
      () =>
        (async () => {
          while (true) {
            const scenarioIndex = nextScenarioIndex();
            if (scenarioIndex === undefined) return;
            const requestStart = scenarioIndex * normalizedRepeats;
            const requestEndExclusive = requestStart + normalizedRepeats;
            try {
              const startedRun = await deps.startWorkspaceScenarioRunForGraphql(
                {
                  workspaceId: args.workspaceId,
                  scenarioDeckId: selectedScenarioDeckId,
                },
              );
              const run = await awaitScenarioRunTerminal(startedRun);
              if (run.status !== "completed") {
                const scenarioError = run.error ??
                  `Scenario run ended with status ${run.status}`;
                await queueBatchUpdate("scenario-run-failed", (current) =>
                  recomputeBatchState(
                    current,
                    current.requests.map((request, requestIndex) =>
                      requestIndex >= requestStart &&
                        requestIndex < requestEndExclusive
                        ? {
                          ...request,
                          scenarioRunId: run.id,
                          status: "error",
                          error: scenarioError,
                        }
                        : request
                    ),
                    {
                      scenarioRunsFailed: current.scenarioRunsFailed + 1,
                    },
                  ));
                continue;
              }
              await queueBatchUpdate("scenario-run-completed", (current) =>
                recomputeBatchState(
                  current,
                  current.requests.map((request, requestIndex) =>
                    requestIndex >= requestStart &&
                      requestIndex < requestEndExclusive
                      ? {
                        ...request,
                        scenarioRunId: run.id,
                      }
                      : request
                  ),
                  {
                    scenarioRunsCompleted: current.scenarioRunsCompleted + 1,
                  },
                ));
              const requestIndexes = Array.from(
                { length: normalizedRepeats },
                (_value, repeatIndex) =>
                  requestStart + repeatIndex,
              );
              enqueueGradeRequestIndexes(requestIndexes);
            } catch (error) {
              const scenarioError = error instanceof Error
                ? error.message
                : String(error);
              await queueBatchUpdate("scenario-run-error", (current) =>
                recomputeBatchState(
                  current,
                  current.requests.map((request, requestIndex) =>
                    requestIndex >= requestStart &&
                      requestIndex < requestEndExclusive
                      ? {
                        ...request,
                        status: "error",
                        error: scenarioError,
                      }
                      : request
                  ),
                  {
                    scenarioRunsFailed: current.scenarioRunsFailed + 1,
                  },
                ));
            }
          }
        })(),
    );
    await Promise.all(scenarioWorkers);
    closeGradeQueue();
    await Promise.all(gradeWorkers);
    await updateQueue;
    return batch;
  };

  return {
    readWorkspaceVerifyBatchesForGraphql,
    createWorkspaceVerifyBatchRunForGraphql,
  };
};
