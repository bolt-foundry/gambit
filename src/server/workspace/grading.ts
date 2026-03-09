import { loadDeck } from "@bolt-foundry/gambit-core";
import type { ModelProvider, SavedState } from "@bolt-foundry/gambit-core";
import type {
  GradingFlag,
  GradingRunRecord,
  WorkspaceDeckState,
} from "../../server_types.ts";
import type { WorkspaceGradeRunForGraphql } from "./types.ts";
import {
  buildScenarioConversationArtifacts,
  buildScenarioConversationArtifactsFromRun,
  gradeSchemaHasField,
} from "./helpers.ts";
import { runDeckWithFallback } from "./run_deck.ts";

export const createWorkspaceGradingService = (deps: {
  randomId: (prefix: string) => string;
  modelProvider: ModelProvider;
  responsesMode?: boolean;
  workerSandbox?: boolean;
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
  readWorkspaceScenarioRunsForGraphql: (workspaceId: string) => Array<{
    id: string;
    messages: Array<{
      role: string;
      content: string;
      messageRefId?: string;
    }>;
  }>;
}) => {
  const readGradingRunsFromState = (
    state: SavedState,
  ): Array<GradingRunRecord> => {
    const meta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    const fromGradingRuns = Array.isArray(meta.gradingRuns)
      ? meta.gradingRuns
      : null;
    const fromCalibrationRuns = Array.isArray(meta.calibrationRuns)
      ? meta.calibrationRuns
      : null;
    const raw = fromGradingRuns ?? fromCalibrationRuns ?? [];
    return raw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const run = entry as GradingRunRecord;
      const id = typeof run.id === "string" && run.id.trim().length > 0
        ? run.id
        : deps.randomId("grade");
      if (
        typeof run.graderId !== "string" || typeof run.graderPath !== "string"
      ) {
        return [];
      }
      return [{
        ...run,
        id,
      }];
    });
  };

  const upsertGradingRunInState = (
    state: SavedState,
    nextRun: GradingRunRecord,
  ): SavedState => {
    const runs = readGradingRunsFromState(state);
    const index = runs.findIndex((entry) => entry.id === nextRun.id);
    const nextRuns = [...runs];
    if (index >= 0) {
      nextRuns[index] = nextRun;
    } else {
      nextRuns.unshift(nextRun);
    }
    const currentMeta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    const nextMeta: Record<string, unknown> = {
      ...currentMeta,
      gradingRuns: nextRuns,
    };
    delete nextMeta.calibrationRuns;
    return { ...state, meta: nextMeta };
  };

  const readGradingFlagsFromState = (
    state: SavedState,
  ): Array<GradingFlag> => {
    const meta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    if (!Array.isArray(meta.gradingFlags)) return [];
    return meta.gradingFlags.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const flag = entry as GradingFlag;
      if (typeof flag.refId !== "string" || flag.refId.trim().length === 0) {
        return [];
      }
      return [{
        id: typeof flag.id === "string" && flag.id.trim().length > 0
          ? flag.id
          : deps.randomId("gflag"),
        refId: flag.refId.trim(),
        runId: typeof flag.runId === "string" ? flag.runId : undefined,
        turnIndex: typeof flag.turnIndex === "number"
          ? flag.turnIndex
          : undefined,
        reason: typeof flag.reason === "string" ? flag.reason : undefined,
        createdAt: typeof flag.createdAt === "string" && flag.createdAt
          ? flag.createdAt
          : new Date().toISOString(),
      }];
    });
  };

  const writeGradingFlagsToState = (
    state: SavedState,
    flags: Array<GradingFlag>,
  ): SavedState => {
    const currentMeta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    return {
      ...state,
      meta: {
        ...currentMeta,
        gradingFlags: flags,
      },
    };
  };

  const extractGradeScoreAndReason = (value: unknown): {
    score?: number;
    reason?: string;
  } => {
    if (!value || typeof value !== "object") return {};
    const record = value as Record<string, unknown>;
    const payload = record.payload && typeof record.payload === "object"
      ? record.payload as Record<string, unknown>
      : record;
    const score = typeof payload.score === "number" ? payload.score : undefined;
    const reason = typeof payload.reason === "string"
      ? payload.reason
      : undefined;
    return { score, reason };
  };

  const extractGradeTurnContext = (value: unknown): {
    priorUser?: string;
    gradedAssistant?: string;
  } => {
    if (!value || typeof value !== "object") return {};
    const input = value as Record<string, unknown>;
    const messageToGrade = input.messageToGrade;
    const gradedAssistant = messageToGrade && typeof messageToGrade === "object"
      ? typeof (messageToGrade as { content?: unknown }).content === "string"
        ? (messageToGrade as { content: string }).content
        : undefined
      : undefined;
    const session = input.session;
    const messages = session && typeof session === "object" &&
        Array.isArray((session as { messages?: unknown }).messages)
      ? (session as { messages: Array<{ role?: string; content?: unknown }> })
        .messages
      : [];
    let priorUser: string | undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "user") continue;
      if (typeof message.content === "string" && message.content.trim()) {
        priorUser = message.content;
        break;
      }
    }
    return { priorUser, gradedAssistant };
  };

  const deriveScenarioRunIdFromGradingRun = (
    run: GradingRunRecord,
  ): string | undefined => {
    if (typeof run.scenarioRunId === "string" && run.scenarioRunId.trim()) {
      return run.scenarioRunId.trim();
    }
    if (!run.input || typeof run.input !== "object") return undefined;
    const input = run.input as Record<string, unknown>;
    const session = input.session;
    if (!session || typeof session !== "object") return undefined;
    const meta = (session as { meta?: unknown }).meta;
    if (!meta || typeof meta !== "object") return undefined;
    const scenarioRunId = (meta as { scenarioRunId?: unknown }).scenarioRunId;
    return typeof scenarioRunId === "string" && scenarioRunId.trim().length > 0
      ? scenarioRunId
      : undefined;
  };

  const toWorkspaceGradeRunForGraphql = (
    run: GradingRunRecord,
    flags: Array<GradingFlag>,
  ): WorkspaceGradeRunForGraphql => {
    const flagByRef = new Map(flags.map((entry) => [entry.refId, entry]));
    const result = run.result && typeof run.result === "object"
      ? run.result as Record<string, unknown>
      : null;
    const turns =
      result && result.mode === "turns" && Array.isArray(result.turns)
        ? result.turns as Array<Record<string, unknown>>
        : [];
    const totalTurns = typeof result?.totalTurns === "number" &&
        Number.isFinite(result.totalTurns)
      ? result.totalTurns
      : turns.length;
    const normalizedTurns = turns.map((turn, index) => {
      const turnIndex =
        typeof turn.index === "number" && Number.isFinite(turn.index)
          ? turn.index
          : index;
      const turnNumber = totalTurns > 0
        ? Math.min(totalTurns, index + 1)
        : index + 1;
      const turnInput = turn.input;
      const turnResult = turn.result;
      const { score, reason } = extractGradeScoreAndReason(turnResult);
      const context = extractGradeTurnContext(turnInput);
      const messageToGrade = turnInput && typeof turnInput === "object"
        ? (turnInput as { messageToGrade?: unknown }).messageToGrade
        : undefined;
      const messageRefId =
        messageToGrade && typeof messageToGrade === "object" &&
          typeof (messageToGrade as { messageRefId?: unknown }).messageRefId ===
            "string"
          ? (messageToGrade as { messageRefId: string }).messageRefId
          : undefined;
      const fallbackRefId = `gradingRun:${run.id}#turn:${turnIndex}`;
      const refId = messageRefId ?? fallbackRefId;
      const turnFlag = flagByRef.get(refId);
      return {
        id: `${run.id}:turn:${turnIndex}`,
        runId: run.id,
        turnIndex,
        turnNumber,
        refId,
        score,
        reason,
        priorUser: context.priorUser,
        gradedAssistant: context.gradedAssistant,
        flagReason: turnFlag?.reason,
      };
    });
    const summaryFromResult = extractGradeScoreAndReason(run.result);
    const scenarioRunId = deriveScenarioRunIdFromGradingRun(run);
    return {
      id: run.id,
      workspaceId: run.workspaceId ?? "",
      scenarioRunId,
      graderId: run.graderId,
      graderPath: run.graderPath,
      graderLabel: run.graderLabel,
      status: run.status,
      runAt: run.runAt,
      error: run.error,
      summary: summaryFromResult.score !== undefined ||
          summaryFromResult.reason !== undefined
        ? summaryFromResult
        : undefined,
      turns: normalizedTurns.map((turn) => ({
        id: turn.id,
        runId: turn.runId,
        turnIndex: turn.turnIndex,
        turnNumber: turn.turnNumber,
        refId: turn.refId,
        score: turn.score,
        reason: turn.reason,
        priorUser: turn.priorUser,
        gradedAssistant: turn.gradedAssistant,
      })),
    };
  };

  const emitGradeWorkspaceEvent = (
    workspaceId: string,
    payload: Record<string, unknown>,
  ) => {
    deps.appendDurableStreamEvent(deps.workspaceStreamId, {
      ...payload,
      workspaceId,
    });
  };

  const readWorkspaceGradingFlagsForGraphql = (
    workspaceId: string,
  ): Array<GradingFlag> => {
    const state = deps.readSessionState(workspaceId);
    if (!state) return [];
    return readGradingFlagsFromState(state);
  };

  const readWorkspaceGradeRunsForGraphql = (
    workspaceId: string,
  ): Array<WorkspaceGradeRunForGraphql> => {
    const state = deps.readSessionState(workspaceId);
    if (!state) return [];
    const runs = readGradingRunsFromState(state).map((entry) => ({
      ...entry,
      workspaceId,
    }));
    const flags = readGradingFlagsFromState(state);
    const projected = runs.map((run) =>
      toWorkspaceGradeRunForGraphql(run, flags)
    );
    projected.sort((a, b) => {
      const left = a.runAt ?? a.id;
      const right = b.runAt ?? b.id;
      return right.localeCompare(left);
    });
    return projected;
  };

  const createWorkspaceGradeRunForGraphql = async (args: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: string | null;
  }): Promise<WorkspaceGradeRunForGraphql> => {
    await deps.activateWorkspaceDeck(args.workspaceId, {
      source: "graphql:createWorkspaceGradeRun",
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

    const explicitScenarioRunId = typeof args.scenarioRunId === "string" &&
        args.scenarioRunId.trim().length > 0
      ? args.scenarioRunId.trim()
      : null;
    const runFromState =
      state.meta && typeof state.meta.scenarioRunId === "string"
        ? state.meta.scenarioRunId
        : null;
    const selectedScenarioRunId = explicitScenarioRunId ?? runFromState;
    const scenarioRun = selectedScenarioRunId
      ? deps.readWorkspaceScenarioRunsForGraphql(args.workspaceId).find((
        entry,
      ) => entry.id === selectedScenarioRunId)
      : null;
    if (selectedScenarioRunId && !scenarioRun) {
      throw new Error(`Scenario run ${selectedScenarioRunId} not found`);
    }
    const artifacts = scenarioRun
      ? buildScenarioConversationArtifactsFromRun(scenarioRun)
      : buildScenarioConversationArtifacts(state);
    const metaForGrading = (() => {
      const baseMeta = state.meta && typeof state.meta === "object"
        ? state.meta as Record<string, unknown>
        : {};
      const next = { ...baseMeta };
      delete next.calibrationRuns;
      delete next.gradingRuns;
      return next;
    })();
    if (selectedScenarioRunId) {
      metaForGrading.scenarioRunId = selectedScenarioRunId;
    }
    const sessionPayload = {
      runId: state.runId,
      messages: artifacts.messages,
      messageRefs: state.messageRefs,
      feedback: state.feedback,
      notes: state.notes,
      conversationScore: state.conversationScore,
      traces: Array.isArray(state.traces) ? state.traces : [],
      meta: metaForGrading,
    };

    const runId = deps.randomId("grade");
    const runAt = new Date().toISOString();
    const runningRun: GradingRunRecord = {
      id: runId,
      workspaceId: args.workspaceId,
      scenarioRunId: selectedScenarioRunId ?? undefined,
      graderId: grader.id,
      graderPath: grader.path,
      graderLabel: grader.label,
      status: "running",
      runAt,
      input: { session: sessionPayload },
    };
    let persistedState = deps.persistSessionState(
      upsertGradingRunInState(state, runningRun),
    );
    deps.appendGradingLog(persistedState, {
      type: "gambit.grade.status",
      workspaceId: args.workspaceId,
      run: runningRun,
    });
    emitGradeWorkspaceEvent(args.workspaceId, {
      type: "gambit.grade.status",
      run: runningRun,
    });

    let completedRun: GradingRunRecord = runningRun;
    try {
      const graderDeck = await loadDeck(grader.path);
      const runMode =
        gradeSchemaHasField(graderDeck.inputSchema, "messageToGrade")
          ? "turns"
          : "conversation";
      const result = runMode === "conversation"
        ? await runDeckWithFallback({
          path: grader.path,
          input: { session: sessionPayload },
          inputProvided: true,
          modelProvider: deps.modelProvider,
          responsesMode: deps.responsesMode,
          workerSandbox: deps.workerSandbox,
        })
        : {
          mode: "turns",
          totalTurns: artifacts.assistantTurns.length,
          turns: await Promise.all(artifacts.assistantTurns.map(
            async (turn) => {
              const messageToGrade =
                turn.message && typeof turn.message === "object"
                  ? {
                    ...(turn.message as Record<string, unknown>),
                    messageRefId: turn.messageRefId,
                  }
                  : turn.message;
              const input = {
                session: sessionPayload,
                messageToGrade,
              };
              const turnResult = await runDeckWithFallback({
                path: grader.path,
                input,
                inputProvided: true,
                modelProvider: deps.modelProvider,
                responsesMode: deps.responsesMode,
                workerSandbox: deps.workerSandbox,
              });
              return {
                index: turn.conversationIndex,
                input,
                result: turnResult,
              };
            },
          )),
        };
      completedRun = {
        ...runningRun,
        status: "completed",
        result,
        error: undefined,
      };
    } catch (error) {
      completedRun = {
        ...runningRun,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    persistedState = deps.persistSessionState(
      upsertGradingRunInState(persistedState, completedRun),
    );
    deps.appendGradingLog(persistedState, {
      type: "gambit.grade.status",
      workspaceId: args.workspaceId,
      run: completedRun,
    });
    emitGradeWorkspaceEvent(args.workspaceId, {
      type: "gambit.grade.status",
      run: completedRun,
    });
    const flags = readGradingFlagsFromState(persistedState);
    return toWorkspaceGradeRunForGraphql(completedRun, flags);
  };

  const toggleWorkspaceGradeFlagForGraphql = (args: {
    workspaceId: string;
    refId: string;
    runId: string;
    turnIndex?: number | null;
  }): Promise<Array<GradingFlag>> => {
    const state = deps.readSessionStateStrict(args.workspaceId, {
      withTraces: true,
    });
    if (!state) throw new Error(`Workspace ${args.workspaceId} not found`);
    const existing = readGradingFlagsFromState(state);
    const refId = args.refId.trim();
    if (!refId) throw new Error("Missing grade flag refId");
    const existingIndex = existing.findIndex((entry) => entry.refId === refId);
    const nextFlags = [...existing];
    if (existingIndex >= 0) {
      nextFlags.splice(existingIndex, 1);
    } else {
      nextFlags.push({
        id: deps.randomId("gflag"),
        refId,
        runId: args.runId,
        turnIndex: typeof args.turnIndex === "number"
          ? args.turnIndex
          : undefined,
        createdAt: new Date().toISOString(),
      });
    }
    const persistedState = deps.persistSessionState(
      writeGradingFlagsToState(state, nextFlags),
    );
    deps.appendGradingLog(persistedState, {
      type: "gambit.grade.flag",
      workspaceId: args.workspaceId,
      action: existingIndex >= 0 ? "remove" : "add",
      refId,
      flags: nextFlags,
    });
    emitGradeWorkspaceEvent(args.workspaceId, {
      type: "gambit.grade.flag",
      action: existingIndex >= 0 ? "remove" : "add",
      refId,
      runId: args.runId,
    });
    return Promise.resolve(readGradingFlagsFromState(persistedState));
  };

  const updateWorkspaceGradeFlagReasonForGraphql = (args: {
    workspaceId: string;
    refId: string;
    reason: string;
  }): Promise<Array<GradingFlag>> => {
    const state = deps.readSessionStateStrict(args.workspaceId, {
      withTraces: true,
    });
    if (!state) throw new Error(`Workspace ${args.workspaceId} not found`);
    const existing = readGradingFlagsFromState(state);
    const refId = args.refId.trim();
    const index = existing.findIndex((entry) => entry.refId === refId);
    if (index < 0) {
      throw new Error(`Flag not found for refId: ${refId}`);
    }
    const nextFlags = [...existing];
    nextFlags[index] = {
      ...nextFlags[index],
      reason: args.reason,
    };
    const persistedState = deps.persistSessionState(
      writeGradingFlagsToState(state, nextFlags),
    );
    deps.appendGradingLog(persistedState, {
      type: "gambit.grade.flag",
      workspaceId: args.workspaceId,
      action: "reason",
      refId,
      reason: args.reason,
      flags: nextFlags,
    });
    emitGradeWorkspaceEvent(args.workspaceId, {
      type: "gambit.grade.flag",
      action: "reason",
      refId,
      runId: nextFlags[index]?.runId,
    });
    return Promise.resolve(readGradingFlagsFromState(persistedState));
  };

  return {
    readWorkspaceGradeRunsForGraphql,
    readWorkspaceGradingFlagsForGraphql,
    createWorkspaceGradeRunForGraphql,
    toggleWorkspaceGradeFlagForGraphql,
    updateWorkspaceGradeFlagReasonForGraphql,
  };
};
