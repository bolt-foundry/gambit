import * as path from "@std/path";
import { existsSync } from "@std/fs";
import type {
  FeedbackEntry,
  SavedState,
  TraceEvent,
} from "@bolt-foundry/gambit-core";

export type ScenarioRunSummary = {
  scenarioRunId: string;
  lastEventSeq: number;
  updatedAt: string;
  selectedScenarioDeckId: string;
  selectedScenarioDeckLabel?: string;
  scenarioConfigPath: string;
};

export type WorkspaceEventDomain = "build" | "test" | "grade" | "session";

export type WorkspaceEventEnvelope = {
  offset: number;
  createdAt: string;
  type: WorkspaceEventDomain;
  data: Record<string, unknown>;
};

type WorkspaceEventRecord = Record<string, unknown> & {
  type: string;
};

export type BuildProjectionRun = {
  id: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  messages: Array<{
    role: string;
    content: string;
    messageRefId?: string;
    feedback?: FeedbackEntry;
    respondStatus?: number;
    respondCode?: string;
    respondMessage?: string;
    respondPayload?: unknown;
    respondMeta?: Record<string, unknown>;
  }>;
  traces?: Array<TraceEvent>;
  toolInserts?: Array<{
    actionCallId?: string;
    parentActionCallId?: string;
    name?: string;
    index: number;
  }>;
};

export type BuildProjectionState = {
  workspaceId: string;
  lastAppliedOffset: number;
  run: BuildProjectionRun;
  state?: SavedState;
};

type SessionStoreDeps = {
  sessionsRoot: string;
  randomId: (prefix: string) => string;
  logger: { warn: (...args: Array<unknown>) => void };
  enrichStateWithSession: (state: SavedState) => {
    state: SavedState;
    dir?: string;
  };
  workspaceStateSchemaVersion: string;
  workspaceSchemaError: (
    workspaceId: string,
    foundVersion: string | null,
  ) => string;
};

const TRACE_EVENT_TYPES = new Set<string>([
  "run.start",
  "message.user",
  "run.end",
  "deck.start",
  "deck.end",
  "action.start",
  "action.end",
  "tool.call",
  "tool.result",
  "model.call",
  "model.result",
  "model.stream.event",
  "log",
  "monolog",
]);

const isTraceEventType = (type: string): boolean =>
  TRACE_EVENT_TYPES.has(type) || type.startsWith("response.") ||
  (type.startsWith("gambit.") &&
    TRACE_EVENT_TYPES.has(type.slice("gambit.".length)));

const normalizePersistedTraceRecord = (
  record: Record<string, unknown>,
): TraceEvent | null => {
  const type = typeof record.type === "string" ? record.type : "";
  if (!type) return null;
  if (TRACE_EVENT_TYPES.has(type) || type.startsWith("response.")) {
    return record as TraceEvent;
  }
  if (!type.startsWith("gambit.")) return null;
  const rawMeta = record._gambit;
  const meta = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
    ? rawMeta as Record<string, unknown>
    : undefined;
  const sourceType = typeof meta?.source_type === "string" &&
      meta.source_type.trim().length > 0
    ? meta.source_type.trim()
    : type.slice("gambit.".length);
  if (!TRACE_EVENT_TYPES.has(sourceType)) return null;
  return {
    ...record,
    type: sourceType,
  } as TraceEvent;
};

const inferWorkspaceDomain = (
  payloadType: string,
): WorkspaceEventDomain | null => {
  if (
    payloadType === "buildBotStatus" || payloadType === "buildBotTrace" ||
    payloadType === "buildBotStream" || payloadType === "buildBotStreamEnd" ||
    payloadType.startsWith("gambit.build.")
  ) {
    return "build";
  }
  if (
    payloadType === "testBotStatus" || payloadType === "testBotTrace" ||
    payloadType === "testBotStream" || payloadType === "testBotStreamEnd" ||
    payloadType.startsWith("gambit.test.")
  ) {
    return "test";
  }
  if (
    payloadType === "calibrateSession" || payloadType === "grading.run" ||
    payloadType === "grading.flag" || payloadType === "grading.flag.reason" ||
    payloadType === "grading.reference" ||
    payloadType.startsWith("gambit.grade.") ||
    payloadType.startsWith("gambit.grading.")
  ) {
    return "grade";
  }
  return "session";
};

const isWorkspaceEventDomain = (
  value: unknown,
): value is WorkspaceEventDomain =>
  value === "build" || value === "test" || value === "grade" ||
  value === "session";

const CANONICAL_EVENT_TYPE_BY_LEGACY = new Map<string, string>([
  ["buildBotStatus", "gambit.build.status"],
  ["buildBotTrace", "gambit.build.trace"],
  ["buildBotStream", "gambit.build.stream.delta"],
  ["buildBotStreamEnd", "gambit.build.stream.done"],
  ["testBotStatus", "gambit.test.status"],
  ["testBotStream", "gambit.test.stream.delta"],
  ["testBotStreamEnd", "gambit.test.stream.done"],
  ["calibrateSession", "gambit.grade.session"],
  ["feedback.update", "gambit.feedback.update"],
  ["grading.run", "gambit.grading.run"],
  ["grading.flag", "gambit.grading.flag"],
  ["grading.flag.reason", "gambit.grading.flag.reason"],
  ["grading.reference", "gambit.grading.reference"],
  ["notes.update", "gambit.notes.update"],
  ["conversation.score.update", "gambit.conversation.score.update"],
  ["session.start", "gambit.session.start"],
  ["server.error", "gambit.server.error"],
]);

const normalizeEventType = (
  type: string,
  kind?: unknown,
): { canonicalType: string; legacyType?: string } => {
  if (type.startsWith("response.") || type.startsWith("gambit.")) {
    return { canonicalType: type };
  }
  if (kind === "trace" || isTraceEventType(type)) {
    return { canonicalType: type };
  }
  const mapped = CANONICAL_EVENT_TYPE_BY_LEGACY.get(type);
  if (mapped) {
    return { canonicalType: mapped, legacyType: type };
  }
  return { canonicalType: `gambit.${type}`, legacyType: type };
};

const safeStringify = (value: unknown, space?: number): string => {
  const stack: Array<unknown> = [];
  return JSON.stringify(
    value,
    function (_key, candidate) {
      if (!candidate || typeof candidate !== "object") {
        return candidate;
      }
      while (stack.length > 0 && stack[stack.length - 1] !== this) {
        stack.pop();
      }
      if (stack.includes(candidate)) {
        return "[Circular]";
      }
      stack.push(candidate);
      return candidate;
    },
    space,
  );
};

export const createSessionStore = (deps: SessionStoreDeps) => {
  const {
    sessionsRoot,
    randomId,
    logger,
    enrichStateWithSession,
    workspaceStateSchemaVersion,
    workspaceSchemaError,
  } = deps;

  const sessionStateCache = new Map<string, SavedState>();
  const sessionWriteQueues = new Map<
    string,
    Array<() => Promise<void> | void>
  >();
  const sessionWriteActive = new Set<string>();
  const sessionOffsetById = new Map<string, number>();
  const buildProjectionCache = new Map<string, BuildProjectionState>();
  const buildProjectionRefreshInFlight = new Map<string, Promise<void>>();

  const drainSessionWriteQueue = async (sessionId: string) => {
    let shouldContinueDrain = false;
    try {
      const queue = sessionWriteQueues.get(sessionId);
      if (!queue) return;
      while (queue.length) {
        const next = queue.shift();
        if (!next) continue;
        try {
          await next();
        } catch (err) {
          logger.warn(
            `[sim] session write failed: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    } finally {
      sessionWriteActive.delete(sessionId);
      const queue = sessionWriteQueues.get(sessionId);
      if (queue && queue.length > 0) {
        sessionWriteActive.add(sessionId);
        shouldContinueDrain = true;
      } else {
        sessionWriteQueues.delete(sessionId);
      }
    }
    if (shouldContinueDrain) {
      void drainSessionWriteQueue(sessionId);
    }
  };

  const enqueueSessionWrite = (
    sessionId: string,
    task: () => Promise<void> | void,
  ) => {
    const queue = sessionWriteQueues.get(sessionId) ?? [];
    queue.push(task);
    sessionWriteQueues.set(sessionId, queue);
    if (sessionWriteActive.has(sessionId)) return;
    sessionWriteActive.add(sessionId);
    void drainSessionWriteQueue(sessionId);
  };

  const mergeSessionState = (
    current: SavedState | undefined,
    next: SavedState,
  ): SavedState => {
    if (!current) return next;
    const merged: SavedState = {
      ...current,
      ...next,
      meta: {
        ...(current.meta ?? {}),
        ...(next.meta ?? {}),
      },
      messages: next.messages ?? current.messages,
      items: next.items ?? current.items,
      format: next.format ?? current.format,
      messageRefs: next.messageRefs ?? current.messageRefs,
      feedback: next.feedback ?? current.feedback,
      notes: next.notes ?? current.notes,
      conversationScore: next.conversationScore ?? current.conversationScore,
      traces: next.traces ?? current.traces,
    };
    return merged;
  };

  const parseFiniteInteger = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (!Number.isInteger(value)) return undefined;
    return value;
  };

  const normalizeBuildProjectionRun = (
    workspaceId: string,
    value: unknown,
  ): BuildProjectionRun => {
    if (!value || typeof value !== "object") {
      return {
        id: workspaceId,
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      };
    }
    const run = value as Record<string, unknown>;
    const status = run.status;
    const normalizedStatus = status === "running" || status === "completed" ||
        status === "error" || status === "canceled"
      ? status
      : "idle";
    return {
      id: typeof run.id === "string" && run.id.trim().length > 0
        ? run.id
        : workspaceId,
      status: normalizedStatus,
      error: typeof run.error === "string" ? run.error : undefined,
      startedAt: typeof run.startedAt === "string" ? run.startedAt : undefined,
      finishedAt: typeof run.finishedAt === "string"
        ? run.finishedAt
        : undefined,
      messages: Array.isArray(run.messages)
        ? run.messages as BuildProjectionRun["messages"]
        : [],
      traces: Array.isArray(run.traces) ? run.traces as Array<TraceEvent> : [],
      toolInserts: Array.isArray(run.toolInserts)
        ? run.toolInserts as BuildProjectionRun["toolInserts"]
        : [],
    };
  };

  const toCanonicalEventRecord = (args: {
    eventType: WorkspaceEventDomain;
    offset: number;
    createdAt: string;
    data: Record<string, unknown>;
  }): WorkspaceEventRecord => {
    const payloadType = typeof args.data.type === "string"
      ? args.data.type
      : `gambit.${args.eventType}.event`;
    const rawMeta = args.data._gambit;
    const meta =
      rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
        ? rawMeta as Record<string, unknown>
        : {};
    return {
      ...args.data,
      type: payloadType,
      offset: args.offset,
      createdAt: args.createdAt,
      _gambit: {
        ...meta,
        domain: args.eventType,
        offset: args.offset,
      },
    };
  };

  const parseEnvelopeRecords = (
    text: string,
  ): {
    records: Array<WorkspaceEventEnvelope>;
    maxOffset: number;
  } => {
    const records: Array<WorkspaceEventEnvelope> = [];
    let maxOffset = -1;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const offset = parseFiniteInteger(parsed.offset) ??
        parseFiniteInteger(
          (parsed._gambit as { offset?: unknown } | undefined)?.offset,
        );
      if (offset === undefined) continue;
      const envelopeType = typeof parsed.type === "string" ? parsed.type : "";
      const nestedData = parsed.data;
      const payload = isWorkspaceEventDomain(envelopeType) &&
          nestedData && typeof nestedData === "object" &&
          !Array.isArray(nestedData)
        ? nestedData as Record<string, unknown>
        : parsed;
      const payloadType = typeof payload.type === "string" ? payload.type : "";
      if (!payloadType) continue;
      const meta = parsed._gambit &&
          typeof parsed._gambit === "object" &&
          !Array.isArray(parsed._gambit)
        ? parsed._gambit as Record<string, unknown>
        : null;
      const domain = (() => {
        const explicit = meta?.domain;
        if (
          explicit === "build" || explicit === "test" ||
          explicit === "grade" || explicit === "session"
        ) {
          return explicit;
        }
        if (isWorkspaceEventDomain(envelopeType)) {
          return envelopeType;
        }
        return inferWorkspaceDomain(payloadType);
      })();
      if (!domain) continue;
      const createdAt = typeof parsed.createdAt === "string"
        ? parsed.createdAt
        : typeof parsed.created_at === "string"
        ? parsed.created_at
        : typeof payload.createdAt === "string"
        ? payload.createdAt
        : typeof payload.created_at === "string"
        ? payload.created_at
        : typeof meta?.created_at === "string"
        ? meta.created_at
        : new Date(0).toISOString();
      const envelope: WorkspaceEventEnvelope = {
        offset,
        type: domain,
        createdAt,
        data: payload,
      };
      records.push(envelope);
      if (offset > maxOffset) {
        maxOffset = offset;
      }
    }
    return { records, maxOffset };
  };

  const readEnvelopeRecords = (
    eventsPath: string,
  ): {
    records: Array<WorkspaceEventEnvelope>;
    maxOffset: number;
  } => {
    try {
      const text = Deno.readTextFileSync(eventsPath);
      return parseEnvelopeRecords(text);
    } catch {
      return { records: [], maxOffset: -1 };
    }
  };

  const readEnvelopeRecordsAsync = async (
    eventsPath: string,
  ): Promise<{
    records: Array<WorkspaceEventEnvelope>;
    maxOffset: number;
  }> => {
    try {
      const text = await Deno.readTextFile(eventsPath);
      return parseEnvelopeRecords(text);
    } catch {
      return { records: [], maxOffset: -1 };
    }
  };

  const ensureMonotonicOffsets = (
    records: Array<WorkspaceEventEnvelope>,
    eventsPath: string,
  ): number => {
    let expected = 0;
    let highest = -1;
    for (const record of records) {
      if (record.offset !== expected) {
        throw new Error(
          `Non-monotonic offset in ${eventsPath}: expected ${expected}, got ${record.offset}`,
        );
      }
      highest = record.offset;
      expected = record.offset + 1;
    }
    return highest;
  };

  const getCurrentSessionOffset = (
    sessionId: string,
    state?: SavedState,
  ): number => {
    const cached = sessionOffsetById.get(sessionId);
    if (cached !== undefined) return cached;
    const fromMeta = parseFiniteInteger(
      (state?.meta as { lastAppliedOffset?: unknown } | undefined)
        ?.lastAppliedOffset,
    ) ??
      parseFiniteInteger(
        (state?.meta as { lastAppliedEventSeq?: unknown } | undefined)
          ?.lastAppliedEventSeq,
      );
    if (fromMeta !== undefined) {
      sessionOffsetById.set(sessionId, fromMeta);
      return fromMeta;
    }
    const eventsPath = typeof state?.meta?.sessionEventsPath === "string"
      ? state.meta.sessionEventsPath
      : path.join(sessionsRoot, sessionId, "events.jsonl");
    const { records } = readEnvelopeRecords(eventsPath);
    if (records.length > 0) {
      const validated = ensureMonotonicOffsets(records, eventsPath);
      sessionOffsetById.set(sessionId, validated);
      return validated;
    }
    sessionOffsetById.set(sessionId, -1);
    return -1;
  };

  const nextSessionOffsetCandidate = (
    sessionId: string,
    state?: SavedState,
  ): number => getCurrentSessionOffset(sessionId, state) + 1;

  const upsertScenarioRunSummary = (meta: Record<string, unknown>) => {
    const scenarioRunId = typeof meta.scenarioRunId === "string"
      ? meta.scenarioRunId
      : undefined;
    if (!scenarioRunId) return;
    const lastEventSeq = parseFiniteInteger(meta.lastAppliedOffset) ??
      parseFiniteInteger(meta.lastAppliedEventSeq) ??
      0;
    const updatedAt = typeof meta.sessionUpdatedAt === "string"
      ? meta.sessionUpdatedAt
      : new Date().toISOString();
    const selectedScenarioDeckId =
      typeof meta.selectedScenarioDeckId === "string"
        ? meta.selectedScenarioDeckId
        : typeof meta.testBotName === "string"
        ? meta.testBotName
        : "unknown";
    const selectedScenarioDeckLabel =
      typeof meta.selectedScenarioDeckLabel === "string"
        ? meta.selectedScenarioDeckLabel
        : undefined;
    const scenarioConfigPath = typeof meta.scenarioConfigPath === "string"
      ? meta.scenarioConfigPath
      : typeof meta.testBotConfigPath === "string"
      ? meta.testBotConfigPath
      : typeof meta.deck === "string"
      ? meta.deck
      : "unknown";
    const previous = Array.isArray(meta.scenarioRunSummaries)
      ? meta.scenarioRunSummaries as Array<ScenarioRunSummary>
      : [];
    const nextSummary: ScenarioRunSummary = {
      scenarioRunId,
      lastEventSeq,
      updatedAt,
      selectedScenarioDeckId,
      selectedScenarioDeckLabel,
      scenarioConfigPath,
    };
    const existingIdx = previous.findIndex((entry) =>
      entry.scenarioRunId === scenarioRunId
    );
    meta.scenarioRunSummaries = existingIdx >= 0
      ? previous.map((entry, idx) => idx === existingIdx ? nextSummary : entry)
      : [...previous, nextSummary];
    meta.scenarioRunSummary = nextSummary;
  };

  const normalizeScenarioRunSummary = (
    value: unknown,
  ): ScenarioRunSummary | null => {
    if (!value || typeof value !== "object") return null;
    const summary = value as Record<string, unknown>;
    const scenarioRunId = typeof summary.scenarioRunId === "string"
      ? summary.scenarioRunId
      : null;
    const lastEventSeq = parseFiniteInteger(summary.lastEventSeq);
    const updatedAt = typeof summary.updatedAt === "string"
      ? summary.updatedAt
      : null;
    const selectedScenarioDeckId =
      typeof summary.selectedScenarioDeckId === "string"
        ? summary.selectedScenarioDeckId
        : null;
    const selectedScenarioDeckLabel =
      typeof summary.selectedScenarioDeckLabel === "string"
        ? summary.selectedScenarioDeckLabel
        : undefined;
    const scenarioConfigPath = typeof summary.scenarioConfigPath === "string"
      ? summary.scenarioConfigPath
      : null;
    if (
      !scenarioRunId || lastEventSeq === undefined || !updatedAt ||
      !selectedScenarioDeckId || !scenarioConfigPath
    ) {
      return null;
    }
    return {
      scenarioRunId,
      lastEventSeq,
      updatedAt,
      selectedScenarioDeckId,
      selectedScenarioDeckLabel,
      scenarioConfigPath,
    };
  };

  const selectCanonicalScenarioRunSummary = (
    meta: Record<string, unknown>,
  ): ScenarioRunSummary | null => {
    const fromCurrent = normalizeScenarioRunSummary(meta.scenarioRunSummary);
    const fromListRaw = Array.isArray(meta.scenarioRunSummaries)
      ? meta.scenarioRunSummaries
      : [];
    const fromList = fromListRaw
      .map((entry) => normalizeScenarioRunSummary(entry))
      .filter((entry): entry is ScenarioRunSummary => Boolean(entry));
    const all = fromCurrent ? [fromCurrent, ...fromList] : fromList;
    if (!all.length) return null;
    all.sort((a, b) => {
      if (a.lastEventSeq !== b.lastEventSeq) {
        return b.lastEventSeq - a.lastEventSeq;
      }
      if (a.updatedAt !== b.updatedAt) {
        return b.updatedAt.localeCompare(a.updatedAt);
      }
      return a.scenarioRunId.localeCompare(b.scenarioRunId);
    });
    return all[0] ?? null;
  };

  const materializeSnapshot = (state: SavedState): SavedState => {
    const snapshot = { ...state };
    const sessionId = typeof snapshot.meta?.sessionId === "string"
      ? snapshot.meta.sessionId
      : undefined;
    if (sessionId) {
      const meta = { ...(snapshot.meta ?? {}) };
      const lastAppliedOffset = getCurrentSessionOffset(
        sessionId,
        snapshot,
      );
      meta.lastAppliedOffset = lastAppliedOffset;
      meta.lastAppliedEventSeq = lastAppliedOffset;
      upsertScenarioRunSummary(meta);
      snapshot.meta = meta;
    }
    delete (snapshot as Record<string, unknown>).traces;
    return snapshot;
  };

  const ensureDirAsync = async (dir: string) => {
    try {
      await Deno.mkdir(dir, { recursive: true });
    } catch {
      // ignore
    }
  };

  const writeJsonAtomic = async (filePath: string, payload: unknown) => {
    const dir = path.dirname(filePath);
    await ensureDirAsync(dir);
    const tmpPath = path.join(
      dir,
      `.tmp-${path.basename(filePath)}-${randomId("tmp")}`,
    );
    await Deno.writeTextFile(tmpPath, safeStringify(payload, 2));
    await Deno.rename(tmpPath, filePath);
  };

  const appendJsonl = async (filePath: string, payload: unknown) => {
    const dir = path.dirname(filePath);
    await ensureDirAsync(dir);
    const line = safeStringify(payload);
    await Deno.writeTextFile(filePath, `${line}\n`, { append: true });
  };

  const readBuildProjection = (workspaceId: string): BuildProjectionState => {
    const cached = buildProjectionCache.get(workspaceId);
    if (cached) return cached;
    const filePath = path.join(sessionsRoot, workspaceId, "build_state.json");
    try {
      const parsed = JSON.parse(
        Deno.readTextFileSync(filePath),
      ) as Record<string, unknown>;
      const lastAppliedOffset = parseFiniteInteger(parsed.lastAppliedOffset) ??
        -1;
      const run = normalizeBuildProjectionRun(
        workspaceId,
        (parsed as { run?: unknown }).run,
      );
      const projection = {
        workspaceId,
        lastAppliedOffset,
        run,
        state: parsed.state && typeof parsed.state === "object"
          ? parsed.state as SavedState
          : undefined,
      } satisfies BuildProjectionState;
      buildProjectionCache.set(workspaceId, projection);
      return projection;
    } catch {
      const empty: BuildProjectionState = {
        workspaceId,
        lastAppliedOffset: -1,
        run: {
          id: workspaceId,
          status: "idle",
          messages: [],
          traces: [],
          toolInserts: [],
        },
        state: undefined,
      };
      buildProjectionCache.set(workspaceId, empty);
      return empty;
    }
  };

  const replayBuildProjection = (
    workspaceId: string,
    envelopes: Array<WorkspaceEventEnvelope>,
  ): BuildProjectionState => {
    const state: BuildProjectionState = {
      workspaceId,
      lastAppliedOffset: -1,
      run: {
        id: workspaceId,
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      },
    };
    for (const envelope of envelopes) {
      state.lastAppliedOffset = envelope.offset;
      if (envelope.type !== "build") continue;
      const payloadType = typeof envelope.data.type === "string"
        ? envelope.data.type
        : "";
      if (
        payloadType === "buildBotStatus" ||
        payloadType === "gambit.build.status"
      ) {
        const run = normalizeBuildProjectionRun(workspaceId, envelope.data.run);
        const existingTraces = Array.isArray(state.run.traces)
          ? state.run.traces
          : [];
        const nextTraces = Array.isArray(run.traces) ? run.traces : [];
        state.run = run;
        if (nextTraces.length === 0 && existingTraces.length > 0) {
          state.run = {
            ...state.run,
            traces: existingTraces,
          };
        }
        const buildStateSnapshot = envelope.data.state;
        if (buildStateSnapshot && typeof buildStateSnapshot === "object") {
          state.state = buildStateSnapshot as SavedState;
        }
        continue;
      }
      if (
        payloadType === "buildBotTrace" || payloadType === "gambit.build.trace"
      ) {
        const event = envelope.data.event;
        if (event && typeof event === "object") {
          const currentTraces = Array.isArray(state.run.traces)
            ? state.run.traces
            : [];
          state.run = {
            ...state.run,
            traces: [...currentTraces, event as TraceEvent],
          };
        }
      }
    }
    return state;
  };

  const rebuildBuildProjectionFromEvents = async (
    workspaceId: string,
    eventsPath: string,
  ) => {
    const { records } = await readEnvelopeRecordsAsync(eventsPath);
    if (records.length > 0) {
      ensureMonotonicOffsets(records, eventsPath);
    }
    const projection = replayBuildProjection(workspaceId, records);
    const buildPath = path.join(sessionsRoot, workspaceId, "build_state.json");
    await writeJsonAtomic(buildPath, projection);
    buildProjectionCache.set(workspaceId, projection);
  };

  const updateSnapshotBoundary = async (
    sessionId: string,
    statePath: string | undefined,
    offset: number,
  ) => {
    if (!statePath) return;
    try {
      const text = await Deno.readTextFile(statePath);
      const parsed = JSON.parse(text) as SavedState;
      const parsedMeta = parsed.meta && typeof parsed.meta === "object"
        ? parsed.meta as Record<string, unknown>
        : {};
      const previousBoundary =
        parseFiniteInteger(parsedMeta.lastAppliedOffset) ??
          parseFiniteInteger(parsedMeta.lastAppliedEventSeq) ??
          -1;
      if (offset <= previousBoundary) return;
      parsedMeta.lastAppliedOffset = offset;
      parsedMeta.lastAppliedEventSeq = offset;
      parsedMeta.sessionUpdatedAt = new Date().toISOString();
      upsertScenarioRunSummary(parsedMeta);
      const nextState = { ...parsed, meta: parsedMeta };
      await writeJsonAtomic(statePath, nextState);
      sessionStateCache.set(sessionId, nextState);
    } catch {
      // Keep append-only logging best-effort even if snapshot boundary update fails.
    }
  };

  const appendWorkspaceEnvelope = (
    state: SavedState,
    eventType: WorkspaceEventDomain,
    data: Record<string, unknown>,
  ): WorkspaceEventEnvelope | null => {
    const sessionId = typeof state.meta?.sessionId === "string"
      ? state.meta.sessionId
      : undefined;
    const eventsPath = typeof state.meta?.sessionEventsPath === "string"
      ? state.meta.sessionEventsPath
      : undefined;
    const statePath = typeof state.meta?.sessionStatePath === "string"
      ? state.meta.sessionStatePath
      : undefined;
    if (!sessionId || !eventsPath) return null;
    const normalizedData = (() => {
      const rawType = typeof data.type === "string" ? data.type : "";
      if (!rawType) return data;
      const { canonicalType, legacyType } = normalizeEventType(
        rawType,
        data.kind,
      );
      if (!legacyType) {
        return { ...data, type: canonicalType };
      }
      const rawMeta = data._gambit;
      const meta =
        rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
          ? rawMeta as Record<string, unknown>
          : {};
      return {
        ...data,
        type: canonicalType,
        _gambit: {
          ...meta,
          legacy_type: legacyType,
          domain: eventType,
        },
      };
    })();
    const createdAt = new Date().toISOString();
    const optimisticOffset = nextSessionOffsetCandidate(sessionId, state);
    const envelope: WorkspaceEventEnvelope = {
      offset: optimisticOffset,
      createdAt,
      type: eventType,
      data: normalizedData,
    };
    enqueueSessionWrite(sessionId, async () => {
      const offset = nextSessionOffsetCandidate(sessionId, state);
      await appendJsonl(
        eventsPath,
        toCanonicalEventRecord({
          eventType,
          offset,
          createdAt,
          data: normalizedData,
        }),
      );
      sessionOffsetById.set(sessionId, offset);
      if (state.meta && typeof state.meta === "object") {
        (state.meta as Record<string, unknown>).lastAppliedOffset = offset;
        (state.meta as Record<string, unknown>).lastAppliedEventSeq = offset;
      }
      await updateSnapshotBoundary(sessionId, statePath, offset);
      if (eventType === "build") {
        await rebuildBuildProjectionFromEvents(sessionId, eventsPath);
      }
    });
    return envelope;
  };

  const appendSessionEvent = (
    state: SavedState,
    payload: Record<string, unknown>,
  ) => appendWorkspaceEnvelope(state, "session", payload);

  const appendFeedbackLog = (
    state: SavedState,
    payload: Record<string, unknown>,
  ) =>
    appendWorkspaceEnvelope(state, "session", {
      ...payload,
      logType: "feedback",
    });

  const appendGradingLog = (
    state: SavedState,
    payload: Record<string, unknown>,
  ) => appendWorkspaceEnvelope(state, "grade", payload);

  const appendErrorLog = (
    state: SavedState,
    payload: Record<string, unknown>,
  ) =>
    appendWorkspaceEnvelope(state, "session", {
      ...payload,
      logType: "error",
    });

  const appendServerErrorLog = (
    workspaceId: string | undefined,
    payload: {
      endpoint: string;
      status: number;
      message: string;
      method?: string;
    },
  ) => {
    if (!workspaceId) return;
    const state = readSessionState(workspaceId);
    if (!state) return;
    appendErrorLog(state, {
      type: "server.error",
      ...payload,
    });
  };

  const loadSessionTraces = (state: SavedState): Array<TraceEvent> => {
    const eventsPath = typeof state.meta?.sessionEventsPath === "string"
      ? state.meta.sessionEventsPath
      : undefined;
    if (!eventsPath) return [];
    try {
      const { records } = readEnvelopeRecords(eventsPath);
      if (records.length > 0) {
        ensureMonotonicOffsets(records, eventsPath);
      }
      const traces: Array<TraceEvent> = [];
      for (const envelope of records) {
        const record = envelope.data;
        const kind = typeof record.kind === "string" ? record.kind : "";
        const type = typeof record.type === "string" ? record.type : "";
        if (kind === "trace" || isTraceEventType(type)) {
          const normalized = normalizePersistedTraceRecord(record);
          if (normalized) traces.push(normalized);
        }
      }
      return traces;
    } catch {
      return [];
    }
  };

  const persistSessionState = (state: SavedState): SavedState => {
    const { state: enriched, dir } = enrichStateWithSession(state);
    const sessionId = typeof enriched.meta?.sessionId === "string"
      ? enriched.meta.sessionId
      : undefined;
    const merged = sessionId
      ? mergeSessionState(sessionStateCache.get(sessionId), enriched)
      : enriched;
    if (sessionId) {
      sessionStateCache.set(sessionId, merged);
    }
    if (dir && sessionId) {
      const snapshot = materializeSnapshot(merged);
      const eventsPath = typeof snapshot.meta?.sessionEventsPath === "string"
        ? snapshot.meta.sessionEventsPath
        : path.join(dir, "events.jsonl");
      const statePath = typeof snapshot.meta?.sessionStatePath === "string"
        ? snapshot.meta.sessionStatePath
        : path.join(dir, "state.json");
      enqueueSessionWrite(sessionId, async () => {
        try {
          await ensureDirAsync(dir);
          let firstWrite = false;
          try {
            await Deno.stat(eventsPath);
          } catch (err) {
            if (err instanceof Deno.errors.NotFound) {
              firstWrite = true;
            } else {
              throw err;
            }
          }
          if (firstWrite) {
            const startOffset = nextSessionOffsetCandidate(sessionId, snapshot);
            await appendJsonl(
              eventsPath,
              toCanonicalEventRecord({
                eventType: "session",
                offset: startOffset,
                createdAt: new Date().toISOString(),
                data: {
                  type: "gambit.session.start",
                  _gambit: {
                    legacy_type: "session.start",
                    domain: "session",
                  },
                  category: "lifecycle",
                  sessionId,
                  runId: snapshot.runId,
                  deck: snapshot.meta?.deck,
                },
              }),
            );
            sessionOffsetById.set(sessionId, startOffset);
          }

          const snapshotOffset = nextSessionOffsetCandidate(
            sessionId,
            snapshot,
          );
          const snapshotToWrite: SavedState = {
            ...snapshot,
            meta: {
              ...(snapshot.meta ?? {}),
              lastAppliedOffset: snapshotOffset,
              lastAppliedEventSeq: snapshotOffset,
            },
          };
          await appendJsonl(
            eventsPath,
            toCanonicalEventRecord({
              eventType: "session",
              offset: snapshotOffset,
              createdAt: new Date().toISOString(),
              data: {
                type: "session.snapshot",
                category: "snapshot",
                sessionId,
                runId: snapshotToWrite.runId,
                state: snapshotToWrite,
              },
            }),
          );
          // Advance in-memory offset immediately after append so a later
          // snapshot write failure cannot cause duplicate offsets on retry.
          sessionOffsetById.set(sessionId, snapshotOffset);
          await writeJsonAtomic(statePath, snapshotToWrite);
          await rebuildBuildProjectionFromEvents(sessionId, eventsPath);
        } catch (err) {
          logger.warn(
            `[sim] failed to persist session state: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      });
    }
    return merged;
  };

  const readSessionStateStrict = (
    sessionId: string,
    opts?: { withTraces?: boolean },
  ): SavedState | undefined => {
    const cached = sessionStateCache.get(sessionId);
    if (cached) {
      if (!opts?.withTraces) return cached;
      const cachedTraces = Array.isArray(cached.traces) ? cached.traces : [];
      if (cachedTraces.length > 0) return cached;
      const loadedTraces = loadSessionTraces(cached);
      if (loadedTraces.length === 0) return cached;
      const withTraces = { ...cached, traces: loadedTraces };
      sessionStateCache.set(sessionId, withTraces);
      return withTraces;
    }
    const dir = path.join(sessionsRoot, sessionId);
    const filePath = path.join(dir, "state.json");
    const text = Deno.readTextFileSync(filePath);
    const parsed = JSON.parse(text) as SavedState;
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Invalid workspace state payload at ${filePath}`);
    }
    const parsedMeta = parsed.meta && typeof parsed.meta === "object"
      ? parsed.meta as Record<string, unknown>
      : {};
    const schemaVersion = typeof parsedMeta.workspaceSchemaVersion === "string"
      ? parsedMeta.workspaceSchemaVersion.trim()
      : null;
    // Backward compatibility: legacy workspace state files may not include
    // workspaceSchemaVersion yet. Treat missing schema as v1-equivalent.
    if (schemaVersion && schemaVersion !== workspaceStateSchemaVersion) {
      throw new Error(workspaceSchemaError(sessionId, schemaVersion));
    }
    const meta = {
      ...parsedMeta,
      sessionId,
      workspaceId: typeof parsedMeta.workspaceId === "string" &&
          parsedMeta.workspaceId.trim().length > 0
        ? parsedMeta.workspaceId
        : sessionId,
      sessionDir: dir,
      workspaceSchemaVersion: workspaceStateSchemaVersion,
    } as Record<string, unknown>;
    if (typeof meta.sessionStatePath !== "string") {
      meta.sessionStatePath = filePath;
    }
    if (typeof meta.sessionEventsPath !== "string") {
      meta.sessionEventsPath = path.join(dir, "events.jsonl");
    }
    if (typeof meta.sessionBuildStatePath !== "string") {
      meta.sessionBuildStatePath = path.join(dir, "build_state.json");
    }

    const eventsPath = typeof meta.sessionEventsPath === "string"
      ? meta.sessionEventsPath
      : undefined;
    if (eventsPath) {
      const { records, maxOffset } = readEnvelopeRecords(eventsPath);
      if (records.length > 0) {
        const validated = ensureMonotonicOffsets(records, eventsPath);
        const lastAppliedOffset = validated >= 0 ? validated : maxOffset;
        meta.lastAppliedOffset = lastAppliedOffset;
        meta.lastAppliedEventSeq = lastAppliedOffset;
        sessionOffsetById.set(sessionId, lastAppliedOffset);
      } else if (typeof meta.lastAppliedOffset !== "number") {
        meta.lastAppliedOffset = -1;
        meta.lastAppliedEventSeq = -1;
      }
    }

    const enriched = { ...parsed, meta } as SavedState;
    if (opts?.withTraces) {
      const loadedTraces = loadSessionTraces(enriched);
      const fallbackTraces = Array.isArray(enriched.traces)
        ? enriched.traces
        : [];
      const traces = loadedTraces.length > 0 ? loadedTraces : fallbackTraces;
      const withTraces = { ...enriched, traces };
      sessionStateCache.set(sessionId, withTraces);
      return withTraces;
    }
    sessionStateCache.set(sessionId, enriched);
    return enriched;
  };

  const readSessionState = (
    sessionId: string,
    opts?: { withTraces?: boolean },
  ): SavedState | undefined => {
    try {
      return readSessionStateStrict(sessionId, opts);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return undefined;
      logger.warn(
        `[sim] failed to read workspace state for ${sessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
  };

  const readBuildState = (
    workspaceId: string,
  ): BuildProjectionState | undefined => {
    const state = readSessionState(workspaceId);
    if (!state) return undefined;
    const eventsPath = typeof state.meta?.sessionEventsPath === "string"
      ? state.meta.sessionEventsPath
      : path.join(sessionsRoot, workspaceId, "events.jsonl");
    const projection = readBuildProjection(workspaceId);
    if (existsSync(eventsPath)) {
      const targetOffset = parseFiniteInteger(
        (state.meta as { lastAppliedOffset?: unknown } | undefined)
          ?.lastAppliedOffset,
      ) ??
        parseFiniteInteger(
          (state.meta as { lastAppliedEventSeq?: unknown } | undefined)
            ?.lastAppliedEventSeq,
        ) ??
        -1;
      if (projection.lastAppliedOffset < targetOffset) {
        if (!buildProjectionRefreshInFlight.has(workspaceId)) {
          const task = rebuildBuildProjectionFromEvents(workspaceId, eventsPath)
            .catch((err) => {
              logger.warn(
                `[sim] failed to refresh build projection for ${workspaceId}: ${
                  err instanceof Error ? err.message : err
                }`,
              );
            })
            .finally(() => {
              buildProjectionRefreshInFlight.delete(workspaceId);
            });
          buildProjectionRefreshInFlight.set(workspaceId, task);
        }
      }
    }
    return projection;
  };

  return {
    parseFiniteInteger,
    selectCanonicalScenarioRunSummary,
    appendWorkspaceEnvelope,
    appendSessionEvent,
    appendFeedbackLog,
    appendGradingLog,
    appendErrorLog,
    appendServerErrorLog,
    persistSessionState,
    readSessionStateStrict,
    readSessionState,
    readBuildState,
    replayBuildProjection,
  };
};
