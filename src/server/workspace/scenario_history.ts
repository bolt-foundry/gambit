import type {
  ModelMessage,
  SavedState,
  TraceEvent,
} from "@bolt-foundry/gambit-core";
import type { TestBotRunStatus } from "./types.ts";
import { summarizeRespondCall, syncTestBotRunFromState } from "./helpers.ts";

const extractPersistedWorkspacePayload = (
  record: Record<string, unknown>,
): Record<string, unknown> => {
  const type = record.type;
  if (
    type !== "build" && type !== "test" && type !== "grade" &&
    type !== "session"
  ) {
    return record;
  }
  const nested = record.data;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return record;
  }
  return nested as Record<string, unknown>;
};

const normalizePersistedTestRunStatus = (
  value: unknown,
  workspaceId: string,
): TestBotRunStatus | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return null;
  const rawStatus = raw.status;
  const status = rawStatus === "running" || rawStatus === "completed" ||
      rawStatus === "error" || rawStatus === "canceled"
    ? rawStatus
    : "idle";
  return {
    id,
    status,
    workspaceId: typeof raw.workspaceId === "string"
      ? raw.workspaceId
      : workspaceId,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : workspaceId,
    error: typeof raw.error === "string" ? raw.error : undefined,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : undefined,
    maxTurns: typeof raw.maxTurns === "number" && Number.isFinite(raw.maxTurns)
      ? raw.maxTurns
      : undefined,
    messages: Array.isArray(raw.messages)
      ? raw.messages as TestBotRunStatus["messages"]
      : [],
    traces: Array.isArray(raw.traces) ? raw.traces as Array<TraceEvent> : [],
    toolInserts: Array.isArray(raw.toolInserts)
      ? raw.toolInserts as TestBotRunStatus["toolInserts"]
      : [],
  };
};

export const readPersistedTestRunStatusById = (
  sessionState: SavedState,
  workspaceId: string,
  requestedRunId: string,
): TestBotRunStatus | null => {
  const eventsPath = typeof sessionState.meta?.sessionEventsPath === "string"
    ? sessionState.meta.sessionEventsPath
    : undefined;
  if (!eventsPath) return null;
  try {
    const text = Deno.readTextFileSync(eventsPath);
    let latest: TestBotRunStatus | null = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      const payload = extractPersistedWorkspacePayload(parsed);
      if (
        payload.type !== "testBotStatus" &&
        payload.type !== "gambit.test.status"
      ) continue;
      const normalized = normalizePersistedTestRunStatus(
        payload.run,
        workspaceId,
      );
      if (!normalized || normalized.id !== requestedRunId) continue;
      latest = normalized;
    }
    return latest;
  } catch {
    return null;
  }
};

export const listPersistedTestRunStatuses = (
  sessionState: SavedState,
  workspaceId: string,
): Array<TestBotRunStatus> => {
  const eventsPath = typeof sessionState.meta?.sessionEventsPath === "string"
    ? sessionState.meta.sessionEventsPath
    : undefined;
  if (!eventsPath) return [];
  try {
    const text = Deno.readTextFileSync(eventsPath);
    const latestByRunId = new Map<string, TestBotRunStatus>();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      const payload = extractPersistedWorkspacePayload(parsed);
      if (
        payload.type !== "testBotStatus" &&
        payload.type !== "gambit.test.status"
      ) continue;
      const normalized = normalizePersistedTestRunStatus(
        payload.run,
        workspaceId,
      );
      if (!normalized || !normalized.id) continue;
      latestByRunId.set(normalized.id, normalized);
    }
    return [...latestByRunId.values()];
  } catch {
    return [];
  }
};

export const listScenarioRunStatusesFromStateMeta = (
  sessionState: SavedState,
  workspaceId: string,
): Array<TestBotRunStatus> => {
  const meta = sessionState.meta && typeof sessionState.meta === "object"
    ? sessionState.meta as Record<string, unknown>
    : null;
  if (!meta) return [];

  const runsById = new Map<string, TestBotRunStatus>();
  const upsertPlaceholder = (runId: string, updatedAt?: string) => {
    if (!runId || runsById.has(runId)) return;
    runsById.set(runId, {
      id: runId,
      status: "completed",
      workspaceId,
      sessionId: workspaceId,
      startedAt: updatedAt,
      finishedAt: updatedAt,
      messages: [],
      traces: [],
      toolInserts: [],
    });
  };

  const primaryRunId = typeof meta.scenarioRunId === "string" &&
      meta.scenarioRunId.trim().length > 0
    ? meta.scenarioRunId.trim()
    : typeof meta.testBotRunId === "string" &&
        meta.testBotRunId.trim().length > 0
    ? meta.testBotRunId.trim()
    : null;
  if (primaryRunId) {
    const primary: TestBotRunStatus = {
      id: primaryRunId,
      status: "idle",
      workspaceId,
      sessionId: workspaceId,
      startedAt: typeof meta.startedAt === "string"
        ? meta.startedAt
        : undefined,
      finishedAt: typeof meta.finishedAt === "string"
        ? meta.finishedAt
        : undefined,
      messages: [],
      traces: [],
      toolInserts: [],
    };
    syncTestBotRunFromState(primary, sessionState);
    if (primary.messages.length > 0 && primary.status === "idle") {
      primary.status = "completed";
    }
    runsById.set(primary.id, primary);
  }

  const summaryValues = [
    meta.scenarioRunSummary,
    ...(Array.isArray(meta.scenarioRunSummaries)
      ? meta.scenarioRunSummaries
      : []),
  ];
  for (const value of summaryValues) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const summary = value as Record<string, unknown>;
    const summaryRunId = typeof summary.scenarioRunId === "string" &&
        summary.scenarioRunId.trim().length > 0
      ? summary.scenarioRunId.trim()
      : null;
    if (!summaryRunId) continue;
    const updatedAt = typeof summary.updatedAt === "string"
      ? summary.updatedAt
      : undefined;
    upsertPlaceholder(summaryRunId, updatedAt);
  }

  return [...runsById.values()];
};

const resolveMessageByRef = (
  state: SavedState,
  messageRefId: string,
): { message?: ModelMessage; ref?: { source?: unknown } } => {
  const refs = Array.isArray(state.messageRefs) ? state.messageRefs : [];
  const messages = Array.isArray(state.messages) ? state.messages : [];
  const idx = refs.findIndex((ref) => ref?.id === messageRefId);
  if (idx < 0) return {};
  return {
    message: messages[idx],
    ref: refs[idx],
  };
};

export const isFeedbackEligibleMessageRef = (
  state: SavedState,
  messageRefId: string,
): boolean => {
  const { message, ref } = resolveMessageByRef(state, messageRefId);
  if (!message) return false;
  if (message.role === "assistant") return true;
  if (message.role === "user" && ref?.source === "scenario") return true;
  return summarizeRespondCall(message) !== null;
};

export const isFeedbackEligiblePersistedTestRunMessageRef = (
  state: SavedState,
  runId: string,
  messageRefId: string,
): boolean => {
  const eventsPath = typeof state.meta?.sessionEventsPath === "string"
    ? state.meta.sessionEventsPath
    : undefined;
  if (!eventsPath) return false;
  try {
    const text = Deno.readTextFileSync(eventsPath);
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      const payload = extractPersistedWorkspacePayload(parsed);
      if (
        payload.type !== "testBotStatus" &&
        payload.type !== "gambit.test.status"
      ) {
        continue;
      }
      const run = payload.run;
      if (!run || typeof run !== "object") continue;
      const runRecord = run as { id?: unknown; messages?: unknown };
      if (typeof runRecord.id !== "string" || runRecord.id !== runId) {
        continue;
      }
      if (!Array.isArray(runRecord.messages)) continue;
      const found = runRecord.messages.some((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const message = entry as {
          role?: unknown;
          messageRefId?: unknown;
          messageSource?: unknown;
        };
        if (message.messageRefId !== messageRefId) return false;
        if (message.role === "assistant") return true;
        return message.role === "user" &&
          message.messageSource === "scenario";
      });
      if (found) return true;
    }
  } catch {
    return false;
  }
  return false;
};
