import * as path from "@std/path";
import { DatabaseSync } from "node:sqlite";
import type {
  AppendOpenResponsesRunEventV0Input,
  FeedbackEntry,
  OpenResponsesRunEventV0,
  SavedState,
  TraceEvent,
} from "@bolt-foundry/gambit-core";
import {
  isOpenResponsesRunEventPayload,
  joinTextParts,
  toOpenResponsesRunEventV0,
} from "@bolt-foundry/gambit-core";
import type {
  AvailableGraderDeck,
  PersistedAssistantDeck,
  PersistedScenarioDeck,
  WorkspaceDeckState,
} from "./server_types.ts";
import {
  isFeedbackEligibleMessageRef,
  isFeedbackEligiblePersistedTestRunMessageRef,
} from "./server/workspace/scenario_history.ts";

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

type OpenResponsesRunEventSubscriptionListener = (
  event: OpenResponsesRunEventV0,
) => void;

type OpenResponsesRunEventStore = {
  byIdempotencyKey: Map<string, OpenResponsesRunEventV0>;
  byRunId: Map<string, Array<OpenResponsesRunEventV0>>;
  hydrated: boolean;
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

const OPENRESPONSES_RUN_EVENT_RECORD_TYPE = "gambit.openresponses.run_event";
const OPENRESPONSES_RUN_EVENT_RECORD_KIND = "openresponses.run_event.v0";
const SESSION_SQLITE_DB_FILENAME = "workspace.sqlite";
const SESSION_SQLITE_SCHEMA_VERSION = 7;
const OPENRESPONSES_EVENTS_SQLITE_TABLE = "openresponses_run_events_v0";
const OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE = "openresponses_output_items_v0";
const WORKSPACE_DECK_STATE_SQLITE_TABLE = "workspace_deck_state_v0";
const WORKSPACE_STATE_SQLITE_TABLE = "workspace_state_v0";
const WORKSPACE_EVENTS_SQLITE_TABLE = "workspace_events_v0";
const BUILD_PROJECTION_SQLITE_TABLE = "build_projection_v0";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function ensureDirSync(dir: string): void {
  try {
    Deno.mkdirSync(dir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

function ensureSessionSqliteSchema(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version;").get() as
    | { user_version?: number }
    | undefined;
  const current = typeof row?.user_version === "number" ? row.user_version : 0;
  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${OPENRESPONSES_EVENTS_SQLITE_TABLE} (
        workspace_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        offset INTEGER NOT NULL UNIQUE,
        UNIQUE (workspace_id, run_id, idempotency_key),
        PRIMARY KEY (workspace_id, run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS ${OPENRESPONSES_EVENTS_SQLITE_TABLE}_workspace_run_sequence_idx
        ON ${OPENRESPONSES_EVENTS_SQLITE_TABLE}(workspace_id, run_id, sequence);
      CREATE INDEX IF NOT EXISTS ${OPENRESPONSES_EVENTS_SQLITE_TABLE}_workspace_run_idempotency_idx
        ON ${OPENRESPONSES_EVENTS_SQLITE_TABLE}(workspace_id, run_id, idempotency_key);
    `);
  }
  if (current < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE} (
        workspace_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        item_key TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_kind TEXT NOT NULL,
        role TEXT,
        content TEXT,
        message_ref_id TEXT,
        reasoning_type TEXT,
        summary TEXT,
        tool_call_id TEXT,
        tool_name TEXT,
        tool_status TEXT,
        arguments_text TEXT,
        result_text TEXT,
        error_text TEXT,
        output_index INTEGER,
        sequence INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, run_id, item_key)
      );
      CREATE INDEX IF NOT EXISTS ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}_workspace_run_sequence_idx
        ON ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}(workspace_id, run_id, sequence);
    `);
  }
  if (current >= 1 && current < 3) {
    db.exec("BEGIN IMMEDIATE;");
    try {
      const migratedTable = `${OPENRESPONSES_EVENTS_SQLITE_TABLE}__v3_migrated`;
      db.exec(`
        DROP TABLE IF EXISTS ${migratedTable};
        CREATE TABLE ${migratedTable} (
          workspace_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          offset INTEGER NOT NULL UNIQUE,
          UNIQUE (workspace_id, run_id, idempotency_key),
          PRIMARY KEY (workspace_id, run_id, sequence)
        );
        INSERT INTO ${migratedTable} (
          workspace_id,
          run_id,
          sequence,
          event_type,
          payload_json,
          idempotency_key,
          created_at,
          offset
        )
        SELECT
          workspace_id,
          run_id,
          sequence,
          event_type,
          payload_json,
          idempotency_key,
          created_at,
          offset
        FROM ${OPENRESPONSES_EVENTS_SQLITE_TABLE}
        ORDER BY offset ASC;
        DROP TABLE ${OPENRESPONSES_EVENTS_SQLITE_TABLE};
        ALTER TABLE ${migratedTable} RENAME TO ${OPENRESPONSES_EVENTS_SQLITE_TABLE};
        CREATE INDEX IF NOT EXISTS ${OPENRESPONSES_EVENTS_SQLITE_TABLE}_workspace_run_sequence_idx
          ON ${OPENRESPONSES_EVENTS_SQLITE_TABLE}(workspace_id, run_id, sequence);
        CREATE INDEX IF NOT EXISTS ${OPENRESPONSES_EVENTS_SQLITE_TABLE}_workspace_run_idempotency_idx
          ON ${OPENRESPONSES_EVENTS_SQLITE_TABLE}(workspace_id, run_id, idempotency_key);
      `);
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
  if (current < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${WORKSPACE_DECK_STATE_SQLITE_TABLE} (
        workspace_id TEXT NOT NULL PRIMARY KEY,
        root_deck_path TEXT NOT NULL,
        assistant_deck_json TEXT NOT NULL,
        scenario_decks_json TEXT NOT NULL,
        grader_decks_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
  if (current < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${WORKSPACE_STATE_SQLITE_TABLE} (
        workspace_id TEXT NOT NULL PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_applied_offset INTEGER NOT NULL DEFAULT -1
      );
    `);
  }
  if (current < 6) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${WORKSPACE_EVENTS_SQLITE_TABLE} (
        workspace_id TEXT NOT NULL,
        offset INTEGER NOT NULL,
        domain TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (workspace_id, offset)
      );
      CREATE INDEX IF NOT EXISTS ${WORKSPACE_EVENTS_SQLITE_TABLE}_workspace_domain_offset_idx
        ON ${WORKSPACE_EVENTS_SQLITE_TABLE}(workspace_id, domain, offset);
    `);
  }
  if (current < 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${BUILD_PROJECTION_SQLITE_TABLE} (
        workspace_id TEXT NOT NULL PRIMARY KEY,
        projection_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_applied_offset INTEGER NOT NULL DEFAULT -1
      );
    `);
  }
  if (current < SESSION_SQLITE_SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${SESSION_SQLITE_SCHEMA_VERSION};`);
  }
}

type OpenResponsesOutputMessageV0 = {
  __typename: "OutputMessage";
  id: string;
  role: string;
  content: string;
  messageRefId?: string;
  feedbackEligible: boolean;
  feedback?: FeedbackEntry;
};

type OpenResponsesOutputReasoningV0 = {
  __typename: "OutputReasoning";
  id: string;
  summary: string;
  reasoningType?: string;
};

type OpenResponsesOutputToolCallV0 = {
  __typename: "OutputToolCall";
  id: string;
  toolCallId: string;
  toolName: string;
  status: "RUNNING" | "COMPLETED" | "ERROR";
  argumentsText?: string;
  resultText?: string;
  error?: string;
};

export type OpenResponsesOutputItemV0 =
  | OpenResponsesOutputMessageV0
  | OpenResponsesOutputReasoningV0
  | OpenResponsesOutputToolCallV0;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseAvailableGraderDeck(
  value: unknown,
): AvailableGraderDeck | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id).trim();
  const label = asString(record.label).trim();
  const path = asString(record.path).trim();
  if (!id || !label || !path) return null;
  const description = asString(record.description).trim();
  return {
    id,
    label,
    path,
    ...(description ? { description } : {}),
  };
}

function parsePersistedScenarioDeck(
  value: unknown,
): PersistedScenarioDeck | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id).trim();
  const label = asString(record.label).trim();
  const path = asString(record.path).trim();
  if (!id || !label || !path) return null;
  const description = asString(record.description).trim();
  const inputSchemaError = asString(record.inputSchemaError).trim();
  const maxTurns = typeof record.maxTurns === "number" &&
      Number.isFinite(record.maxTurns)
    ? Math.round(record.maxTurns)
    : undefined;
  return {
    id,
    label,
    path,
    ...(description ? { description } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...("inputSchema" in record ? { inputSchema: record.inputSchema } : {}),
    ...("defaults" in record ? { defaults: record.defaults } : {}),
    ...(inputSchemaError ? { inputSchemaError } : {}),
  };
}

function parsePersistedAssistantDeck(
  value: unknown,
): PersistedAssistantDeck | null {
  const record = asRecord(value);
  if (!record) return null;
  const deck = asString(record.deck).trim();
  if (!deck) return null;
  const startMode = record.startMode === "user" ? "user" : "assistant";
  const modelParams = asRecord(record.modelParams) ?? undefined;
  const tools = Array.isArray(record.tools)
    ? record.tools.map((entry) => {
      const tool = asRecord(entry);
      if (!tool) return null;
      const name = asString(tool.name).trim();
      if (!name) return null;
      const label = asString(tool.label).trim();
      const description = asString(tool.description).trim();
      const toolPath = asString(tool.path).trim();
      return {
        name,
        ...(label ? { label } : {}),
        ...(description ? { description } : {}),
        ...(toolPath ? { path: toolPath } : {}),
      };
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : undefined;
  const inputSchemaError = asString(record.inputSchemaError).trim();
  return {
    deck,
    startMode,
    ...(modelParams ? { modelParams } : {}),
    ...("inputSchema" in record ? { inputSchema: record.inputSchema } : {}),
    ...("defaults" in record ? { defaults: record.defaults } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(inputSchemaError ? { inputSchemaError } : {}),
  };
}

function parseWorkspaceDeckStateRow(value: unknown): WorkspaceDeckState | null {
  const record = asRecord(value);
  if (!record) return null;
  const workspaceId = asString(record.workspace_id).trim();
  const rootDeckPath = asString(record.root_deck_path).trim();
  const updatedAt = asString(record.updated_at).trim();
  if (!workspaceId || !rootDeckPath || !updatedAt) return null;
  const assistantDeck = parsePersistedAssistantDeck(
    parseJsonString(record.assistant_deck_json),
  );
  if (!assistantDeck) return null;
  const scenarioDecksRaw = parseJsonString(record.scenario_decks_json);
  const graderDecksRaw = parseJsonString(record.grader_decks_json);
  if (!Array.isArray(scenarioDecksRaw) || !Array.isArray(graderDecksRaw)) {
    return null;
  }
  const scenarioDecks = scenarioDecksRaw.map(parsePersistedScenarioDeck).filter(
    (entry): entry is PersistedScenarioDeck => entry !== null,
  );
  const graderDecks = graderDecksRaw.map(parseAvailableGraderDeck).filter(
    (entry): entry is AvailableGraderDeck => entry !== null,
  );
  return {
    workspaceId,
    rootDeckPath,
    assistantDeck,
    scenarioDecks,
    graderDecks,
    updatedAt,
  };
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toEventMessageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((entry) => {
      if (typeof entry === "string") return entry;
      const record = asRecord(entry);
      if (!record) return "";
      const text = asString(record.text);
      if (text.length > 0) return text;
      return toEventMessageText(record.content);
    });
    return joinTextParts(parts);
  }
  const record = asRecord(value);
  if (!record) return "";
  const text = asString(record.text);
  if (text.length > 0) return text;
  return toEventMessageText(record.content);
}

export const createSessionStore = (deps: SessionStoreDeps) => {
  const {
    sessionsRoot,
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
  const openResponsesRunEventsBySession = new Map<
    string,
    OpenResponsesRunEventStore
  >();
  const sessionSqliteById = new Map<string, DatabaseSync>();
  const openResponsesRunEventListenersBySessionRun = new Map<
    string,
    Set<OpenResponsesRunEventSubscriptionListener>
  >();

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

  const enqueueSessionWriteResult = <T>(
    sessionId: string,
    task: () => Promise<T> | T,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      enqueueSessionWrite(sessionId, async () => {
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      });
    });

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

  const getSessionSqlitePath = (
    sessionId: string,
    state?: SavedState,
  ): string => {
    const stateMeta = state?.meta as Record<string, unknown> | undefined;
    const fromMeta = typeof stateMeta?.sessionSqlitePath === "string"
      ? stateMeta.sessionSqlitePath
      : "";
    if (fromMeta.trim().length > 0) return fromMeta;
    const sessionDir = typeof stateMeta?.sessionDir === "string"
      ? stateMeta.sessionDir
      : path.join(sessionsRoot, sessionId);
    return path.join(sessionDir, SESSION_SQLITE_DB_FILENAME);
  };

  const getSessionSqliteDb = (
    sessionId: string,
    state?: SavedState,
  ): DatabaseSync => {
    const existing = sessionSqliteById.get(sessionId);
    if (existing) return existing;
    const sqlitePath = getSessionSqlitePath(sessionId, state);
    ensureDirSync(path.dirname(sqlitePath));
    const db = new DatabaseSync(sqlitePath);
    db.exec("PRAGMA busy_timeout=5000;");
    db.exec("PRAGMA journal_mode=WAL;");
    ensureSessionSqliteSchema(db);
    sessionSqliteById.set(sessionId, db);
    return db;
  };

  const getWorkspaceIdForState = (
    sessionId: string,
    state?: SavedState,
  ): string => {
    const workspaceId = typeof state?.meta?.workspaceId === "string"
      ? state.meta.workspaceId.trim()
      : "";
    return workspaceId || sessionId;
  };

  const readWorkspaceStateRow = (
    sessionId: string,
    state?: SavedState,
  ): {
    state_json: string;
    updated_at: string;
    last_applied_offset: number;
  } | null => {
    const workspaceId = getWorkspaceIdForState(sessionId, state);
    const db = getSessionSqliteDb(sessionId, state);
    return db.prepare(
      `SELECT state_json, updated_at, last_applied_offset
       FROM ${WORKSPACE_STATE_SQLITE_TABLE}
       WHERE workspace_id = ?`,
    ).get(workspaceId) as
      | {
        state_json: string;
        updated_at: string;
        last_applied_offset: number;
      }
      | null;
  };

  const writeWorkspaceStateRow = (args: {
    sessionId: string;
    state: SavedState;
    updatedAt?: string;
  }): SavedState => {
    const workspaceId = getWorkspaceIdForState(args.sessionId, args.state);
    const db = getSessionSqliteDb(args.sessionId, args.state);
    const snapshot = materializeSnapshot(args.state);
    const lastAppliedOffset = parseFiniteInteger(
      (snapshot.meta as { lastAppliedOffset?: unknown } | undefined)
        ?.lastAppliedOffset,
    ) ??
      parseFiniteInteger(
        (snapshot.meta as { lastAppliedEventSeq?: unknown } | undefined)
          ?.lastAppliedEventSeq,
      ) ?? -1;
    const updatedAt = args.updatedAt ?? new Date().toISOString();
    db.prepare(
      `INSERT INTO ${WORKSPACE_STATE_SQLITE_TABLE} (
        workspace_id,
        state_json,
        updated_at,
        last_applied_offset
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at,
        last_applied_offset = excluded.last_applied_offset`,
    ).run(
      workspaceId,
      safeStringify(snapshot),
      updatedAt,
      lastAppliedOffset,
    );
    return snapshot;
  };

  const readWorkspaceEventRows = (args: {
    sessionId: string;
    state?: SavedState;
    workspaceId?: string;
    domain?: WorkspaceEventDomain;
    fromOffset?: number;
  }): Array<{
    offset: number;
    domain: WorkspaceEventDomain;
    created_at: string;
    payload_json: string;
  }> => {
    const workspaceId = args.workspaceId ??
      getWorkspaceIdForState(args.sessionId, args.state);
    const fromOffset = args.fromOffset ?? 0;
    const db = getSessionSqliteDb(args.sessionId, args.state);
    if (args.domain) {
      return db.prepare(
        `SELECT offset, domain, created_at, payload_json
         FROM ${WORKSPACE_EVENTS_SQLITE_TABLE}
         WHERE workspace_id = ? AND domain = ? AND offset >= ?
         ORDER BY offset ASC`,
      ).all(workspaceId, args.domain, fromOffset) as Array<{
        offset: number;
        domain: WorkspaceEventDomain;
        created_at: string;
        payload_json: string;
      }>;
    }
    return db.prepare(
      `SELECT offset, domain, created_at, payload_json
       FROM ${WORKSPACE_EVENTS_SQLITE_TABLE}
       WHERE workspace_id = ? AND offset >= ?
       ORDER BY offset ASC`,
    ).all(workspaceId, fromOffset) as Array<{
      offset: number;
      domain: WorkspaceEventDomain;
      created_at: string;
      payload_json: string;
    }>;
  };

  const listWorkspaceEnvelopes = (args: {
    workspaceId: string;
    fromOffset?: number;
    domain?: WorkspaceEventDomain;
    state?: SavedState;
    sessionId?: string;
  }): Array<WorkspaceEventEnvelope> => {
    const state = args.state;
    const sessionId = args.sessionId ??
      (typeof state?.meta?.sessionId === "string"
        ? state.meta.sessionId
        : args.workspaceId);
    return readWorkspaceEventRows({
      sessionId,
      state,
      workspaceId: args.workspaceId,
      fromOffset: args.fromOffset,
      domain: args.domain,
    }).flatMap((row) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        return [];
      }
      if (!isObjectRecord(payload)) return [];
      return [
        {
          offset: row.offset,
          createdAt: row.created_at,
          type: row.domain,
          data: payload,
        } satisfies WorkspaceEventEnvelope,
      ];
    });
  };

  const readWorkspaceDeckState = (
    workspaceId: string,
  ): WorkspaceDeckState | null => {
    if (!workspaceId || workspaceId.trim().length === 0) return null;
    try {
      const db = getSessionSqliteDb(workspaceId, readSessionState(workspaceId));
      const row = db.prepare(
        `SELECT workspace_id, root_deck_path, assistant_deck_json, scenario_decks_json, grader_decks_json, updated_at
         FROM ${WORKSPACE_DECK_STATE_SQLITE_TABLE}
         WHERE workspace_id = ?`,
      ).get(workspaceId);
      const parsed = parseWorkspaceDeckStateRow(row);
      if (parsed) return parsed;
      if (row) {
        logger.warn(
          `[sim] failed to parse workspace deck state for ${workspaceId}`,
        );
      }
      return null;
    } catch (error) {
      logger.warn(
        `[sim] failed to read workspace deck state for ${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  };

  const writeWorkspaceDeckState = (
    state: WorkspaceDeckState,
  ): Promise<WorkspaceDeckState> =>
    enqueueSessionWriteResult(state.workspaceId, () => {
      const db = getSessionSqliteDb(
        state.workspaceId,
        readSessionState(state.workspaceId),
      );
      db.prepare(
        `INSERT INTO ${WORKSPACE_DECK_STATE_SQLITE_TABLE} (
          workspace_id,
          root_deck_path,
          assistant_deck_json,
          scenario_decks_json,
          grader_decks_json,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          root_deck_path = excluded.root_deck_path,
          assistant_deck_json = excluded.assistant_deck_json,
          scenario_decks_json = excluded.scenario_decks_json,
          grader_decks_json = excluded.grader_decks_json,
          updated_at = excluded.updated_at`,
      ).run(
        state.workspaceId,
        state.rootDeckPath,
        safeStringify(state.assistantDeck),
        safeStringify(state.scenarioDecks),
        safeStringify(state.graderDecks),
        state.updatedAt,
      );
      return state;
    });

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

  const openResponsesRunEventListenerKey = (
    workspaceId: string,
    runId: string,
  ): string => `${workspaceId}::${runId}`;
  const openResponsesRunEventIdempotencyKey = (
    workspaceId: string,
    runId: string,
    idempotencyKey: string,
  ): string => `${workspaceId}::${runId}::${idempotencyKey}`;

  const getOpenResponsesRunEventStore = (
    sessionId: string,
  ): OpenResponsesRunEventStore => {
    const existing = openResponsesRunEventsBySession.get(sessionId);
    if (existing) return existing;
    const created: OpenResponsesRunEventStore = {
      byIdempotencyKey: new Map(),
      byRunId: new Map(),
      hydrated: false,
    };
    openResponsesRunEventsBySession.set(sessionId, created);
    return created;
  };

  const indexOpenResponsesRunEvent = (
    store: OpenResponsesRunEventStore,
    event: OpenResponsesRunEventV0,
  ) => {
    const idempotencyStoreKey = openResponsesRunEventIdempotencyKey(
      event.workspace_id,
      event.run_id,
      event.idempotency_key,
    );
    if (store.byIdempotencyKey.has(idempotencyStoreKey)) {
      return;
    }
    store.byIdempotencyKey.set(idempotencyStoreKey, event);
    const runStoreKey = openResponsesRunEventListenerKey(
      event.workspace_id,
      event.run_id,
    );
    const byRun = store.byRunId.get(runStoreKey) ?? [];
    byRun.push(event);
    byRun.sort((a, b) => a.sequence - b.sequence);
    store.byRunId.set(runStoreKey, byRun);
  };

  type OutputItemUpsertRow = {
    workspaceId: string;
    runId: string;
    itemKey: string;
    itemId: string;
    itemKind: "message" | "reasoning" | "tool_call";
    role: string | null;
    content: string | null;
    messageRefId: string | null;
    reasoningType: string | null;
    summary: string | null;
    summaryMode: "replace" | "append";
    toolCallId: string | null;
    toolName: string | null;
    toolStatus: "RUNNING" | "COMPLETED" | "ERROR" | null;
    argumentsText: string | null;
    resultText: string | null;
    errorText: string | null;
    outputIndex: number | null;
    sequence: number;
    canonicalBackfill?: boolean;
  };

  const projectOutputItemRowsFromEvent = (
    event: OpenResponsesRunEventV0,
  ): Array<OutputItemUpsertRow> => {
    const payload = asRecord(event.payload);
    if (!payload) return [];
    const payloadType = asString(payload.type) || event.event_type;
    if (payloadType === "input.item") {
      const role = asString(payload.role).trim() || "user";
      const text = toEventMessageText(payload.content).trim() ||
        asString(payload.text).trim();
      if (!text || role !== "user") return [];
      return [{
        workspaceId: event.workspace_id,
        runId: event.run_id,
        itemKey: `input:event:${event.sequence}`,
        itemId: `${event.run_id}:input:event:${event.sequence}`,
        itemKind: "message",
        role,
        content: text,
        messageRefId: asString(payload.message_id).trim() ||
          asString(payload.messageRefId).trim() ||
          null,
        reasoningType: null,
        summary: null,
        summaryMode: "replace",
        toolCallId: null,
        toolName: null,
        toolStatus: null,
        argumentsText: null,
        resultText: null,
        errorText: null,
        outputIndex: null,
        sequence: event.sequence,
      }];
    }
    if (
      payloadType === "response.reasoning.delta" ||
      payloadType === "response.reasoning.done" ||
      payloadType === "response.reasoning_summary_text.delta" ||
      payloadType === "response.reasoning_summary_text.done" ||
      payloadType === "response.reasoning_summary_part.added" ||
      payloadType === "response.reasoning_summary_part.done"
    ) {
      const outputIndex = asFiniteNumber(payload.output_index);
      const itemId = asString(payload.item_id).trim() ||
        `reasoning-${outputIndex ?? event.sequence}`;
      const text = asString(payload.delta).trim() ||
        asString(payload.text).trim() ||
        toEventMessageText(payload.part).trim() ||
        toEventMessageText(payload.summary).trim();
      if (!text) return [];
      const appendMode = payloadType.endsWith(".delta") ||
        payloadType.endsWith(".added");
      return [{
        workspaceId: event.workspace_id,
        runId: event.run_id,
        itemKey: `reasoning:${itemId}`,
        itemId: `${event.run_id}:reasoning:${itemId}`,
        itemKind: "reasoning",
        role: null,
        content: null,
        messageRefId: null,
        reasoningType: payloadType,
        summary: text,
        summaryMode: appendMode ? "append" : "replace",
        toolCallId: null,
        toolName: null,
        toolStatus: null,
        argumentsText: null,
        resultText: null,
        errorText: null,
        outputIndex,
        sequence: event.sequence,
      }];
    }
    if (payloadType !== "response.output_item.done") return [];
    const item = asRecord(payload.item);
    if (!item) return [];
    const itemType = asString(item.type);
    const outputIndex = asFiniteNumber(payload.output_index);
    if (itemType === "function_call" || itemType === "tool_call") {
      const toolCallId = asString(item.call_id).trim() ||
        asString(item.id).trim() ||
        `tool-${outputIndex ?? event.sequence}`;
      return [{
        workspaceId: event.workspace_id,
        runId: event.run_id,
        itemKey: `tool:${toolCallId}`,
        itemId: `${event.run_id}:tool:${toolCallId}`,
        itemKind: "tool_call",
        role: null,
        content: null,
        messageRefId: null,
        reasoningType: null,
        summary: null,
        summaryMode: "replace",
        toolCallId,
        toolName: asString(item.name).trim() || "tool_call",
        toolStatus: "RUNNING",
        argumentsText: asString(item.arguments).trim() || null,
        resultText: asString(item.output).trim() || null,
        errorText: asString(item.error).trim() || null,
        outputIndex,
        sequence: event.sequence,
      }];
    }
    if (itemType === "function_call_output") {
      const toolCallId = asString(item.call_id).trim() ||
        asString(item.id).trim() ||
        `tool-${outputIndex ?? event.sequence}`;
      const resultText = asString(item.output).trim() ||
        toEventMessageText(item.output).trim();
      const errorText = asString(item.error).trim() || null;
      return [{
        workspaceId: event.workspace_id,
        runId: event.run_id,
        itemKey: `tool:${toolCallId}`,
        itemId: `${event.run_id}:tool:${toolCallId}`,
        itemKind: "tool_call",
        role: null,
        content: null,
        messageRefId: null,
        reasoningType: null,
        summary: null,
        summaryMode: "replace",
        toolCallId,
        toolName: asString(item.name).trim() || null,
        toolStatus: errorText ? "ERROR" : "COMPLETED",
        argumentsText: asString(item.arguments).trim() || null,
        resultText: resultText || null,
        errorText,
        outputIndex,
        sequence: event.sequence,
      }];
    }
    if (
      itemType === "message" || itemType === "agent_message" ||
      itemType === "assistant_message"
    ) {
      const text = toEventMessageText(item.content).trim() ||
        toEventMessageText(item.text).trim();
      if (!text) return [];
      const role = asString(item.role).trim() || "assistant";
      const rawItemId = asString(item.id).trim() || null;
      const canonicalBackfill = event.idempotency_key.includes(":canonical:");
      const messageRefId = asString(item.messageRefId).trim() ||
        (canonicalBackfill ? rawItemId : null);
      const itemIdentity = messageRefId ?? rawItemId;
      // Canonical assistant messages can be projected once from the live trace
      // and again from the final saved-state backfill. When both carry the same
      // messageRefId, use that as the stable sqlite key so they collapse into
      // one raw output item instead of surfacing as duplicates in GraphQL/sqlite.
      const itemKey = itemIdentity
        ? `message:${role}:${itemIdentity}`
        : `output:${outputIndex ?? "na"}:${event.sequence}`;
      return [{
        workspaceId: event.workspace_id,
        runId: event.run_id,
        itemKey,
        itemId: itemIdentity ??
          `${event.run_id}:output:${outputIndex ?? "na"}:${event.sequence}`,
        itemKind: "message",
        role,
        content: text,
        messageRefId,
        reasoningType: null,
        summary: null,
        summaryMode: "replace",
        toolCallId: null,
        toolName: null,
        toolStatus: null,
        argumentsText: null,
        resultText: null,
        errorText: null,
        outputIndex,
        sequence: event.sequence,
        canonicalBackfill,
      }];
    }
    if (itemType === "reasoning") {
      const summary = toEventMessageText(item.summary).trim() ||
        asString(item.text).trim();
      if (!summary) return [];
      const itemId = asString(item.id).trim() ||
        `reasoning-${outputIndex ?? event.sequence}`;
      return [{
        workspaceId: event.workspace_id,
        runId: event.run_id,
        itemKey: `reasoning:${itemId}`,
        itemId: `${event.run_id}:reasoning:${itemId}`,
        itemKind: "reasoning",
        role: null,
        content: null,
        messageRefId: null,
        reasoningType: itemType,
        summary,
        summaryMode: "replace",
        toolCallId: null,
        toolName: null,
        toolStatus: null,
        argumentsText: null,
        resultText: null,
        errorText: null,
        outputIndex,
        sequence: event.sequence,
      }];
    }
    return [];
  };

  const upsertOutputItemRow = (
    db: DatabaseSync,
    row: OutputItemUpsertRow,
  ) => {
    let itemKey = row.itemKey;
    if (
      row.canonicalBackfill === true &&
      row.itemKind === "message" &&
      row.role === "assistant" &&
      typeof row.messageRefId === "string" &&
      row.messageRefId.trim().length > 0 &&
      typeof row.content === "string" &&
      row.content.trim().length > 0
    ) {
      const canonicalRow = db.prepare(`
        SELECT item_key
        FROM ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}
        WHERE workspace_id = ? AND run_id = ? AND item_key = ?
        LIMIT 1
      `).get(row.workspaceId, row.runId, row.itemKey) as
        | { item_key?: string | null }
        | undefined;
      if (!canonicalRow?.item_key) {
        const unresolvedMatch = db.prepare(`
          SELECT item_key
          FROM ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}
          WHERE workspace_id = ?
            AND run_id = ?
            AND item_kind = 'message'
            AND role = 'assistant'
            AND content = ?
            AND message_ref_id IS NULL
            AND sequence < ?
          ORDER BY sequence DESC, output_index DESC, item_key DESC
          LIMIT 1
        `).get(
          row.workspaceId,
          row.runId,
          row.content,
          row.sequence,
        ) as
          | { item_key?: string | null }
          | undefined;
        if (
          typeof unresolvedMatch?.item_key === "string" &&
          unresolvedMatch.item_key.trim().length > 0
        ) {
          itemKey = unresolvedMatch.item_key.trim();
        }
      }
    }
    let summary = row.summary;
    if (row.itemKind === "reasoning" && row.summaryMode === "append") {
      const existing = db.prepare(`
        SELECT summary
        FROM ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}
        WHERE workspace_id = ? AND run_id = ? AND item_key = ?
        LIMIT 1
      `).get(row.workspaceId, row.runId, itemKey) as
        | { summary?: string | null }
        | undefined;
      summary = `${existing?.summary ?? ""}${row.summary ?? ""}`;
    }
    db.prepare(`
      INSERT INTO ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE} (
        workspace_id,
        run_id,
        item_key,
        item_id,
        item_kind,
        role,
        content,
        message_ref_id,
        reasoning_type,
        summary,
        tool_call_id,
        tool_name,
        tool_status,
        arguments_text,
        result_text,
        error_text,
        output_index,
        sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, run_id, item_key) DO UPDATE SET
        item_id = excluded.item_id,
        item_kind = excluded.item_kind,
        role = excluded.role,
        content = excluded.content,
        message_ref_id = excluded.message_ref_id,
        reasoning_type = excluded.reasoning_type,
        summary = excluded.summary,
        tool_call_id = excluded.tool_call_id,
        tool_name = COALESCE(excluded.tool_name, ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}.tool_name),
        tool_status = excluded.tool_status,
        arguments_text = COALESCE(excluded.arguments_text, ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}.arguments_text),
        result_text = excluded.result_text,
        error_text = excluded.error_text,
        output_index = COALESCE(${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}.output_index, excluded.output_index),
        sequence = CASE
          WHEN excluded.sequence > ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}.sequence THEN excluded.sequence
          ELSE ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}.sequence
        END
    `).run(
      row.workspaceId,
      row.runId,
      itemKey,
      row.itemId,
      row.itemKind,
      row.role,
      row.content,
      row.messageRefId,
      row.reasoningType,
      summary,
      row.toolCallId,
      row.toolName,
      row.toolStatus,
      row.argumentsText,
      row.resultText,
      row.errorText,
      row.outputIndex,
      row.sequence,
    );
  };

  const persistOutputItemsFromRunEvent = (
    db: DatabaseSync,
    event: OpenResponsesRunEventV0,
  ) => {
    const rows = projectOutputItemRowsFromEvent(event);
    for (const row of rows) {
      upsertOutputItemRow(db, row);
    }
  };

  const hydrateOpenResponsesRunEvents = (
    sessionId: string,
    state: SavedState | undefined,
  ) => {
    const store = getOpenResponsesRunEventStore(sessionId);
    if (store.hydrated) return;
    const db = getSessionSqliteDb(sessionId, state);
    const rows = db.prepare(`
      SELECT
        workspace_id,
        run_id,
        sequence,
        event_type,
        payload_json,
        idempotency_key,
        created_at
      FROM ${OPENRESPONSES_EVENTS_SQLITE_TABLE}
      ORDER BY run_id ASC, sequence ASC
    `).all() as Array<{
      workspace_id: string;
      run_id: string;
      sequence: number;
      event_type: string;
      payload_json: string;
      idempotency_key: string;
      created_at: string;
    }>;
    for (const row of rows) {
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        continue;
      }
      if (!isOpenResponsesRunEventPayload(payload)) continue;
      indexOpenResponsesRunEvent(store, {
        workspace_id: row.workspace_id,
        run_id: row.run_id,
        sequence: row.sequence,
        event_type: row.event_type,
        payload,
        idempotency_key: row.idempotency_key,
        created_at: row.created_at,
      });
    }
    store.hydrated = true;
  };

  const appendOpenResponsesRunEventSqlite = (args: {
    sessionId: string;
    state: SavedState;
    input: AppendOpenResponsesRunEventV0Input;
    workspaceId: string;
    offset: number;
  }): { event: OpenResponsesRunEventV0; inserted: boolean } => {
    const db = getSessionSqliteDb(args.sessionId, args.state);
    const existing = db.prepare(`
      SELECT
        workspace_id,
        run_id,
        sequence,
        event_type,
        payload_json,
        idempotency_key,
        created_at
      FROM ${OPENRESPONSES_EVENTS_SQLITE_TABLE}
      WHERE workspace_id = ? AND run_id = ? AND idempotency_key = ?
      LIMIT 1
    `).get(args.workspaceId, args.input.run_id, args.input.idempotency_key) as
      | {
        workspace_id: string;
        run_id: string;
        sequence: number;
        event_type: string;
        payload_json: string;
        idempotency_key: string;
        created_at: string;
      }
      | undefined;
    if (existing) {
      // JSON.parse returns `any`; force a runtime-validation path via unknown first.
      const payload = JSON.parse(existing.payload_json) as unknown;
      if (isOpenResponsesRunEventPayload(payload)) {
        return {
          event: {
            workspace_id: existing.workspace_id,
            run_id: existing.run_id,
            sequence: existing.sequence,
            event_type: existing.event_type,
            payload,
            idempotency_key: existing.idempotency_key,
            created_at: existing.created_at,
          },
          inserted: false,
        };
      }
    }
    db.exec("BEGIN IMMEDIATE;");
    try {
      const sequenceRow = db.prepare(`
        SELECT MAX(sequence) AS sequence
        FROM ${OPENRESPONSES_EVENTS_SQLITE_TABLE}
        WHERE workspace_id = ? AND run_id = ?
      `).get(args.workspaceId, args.input.run_id) as { sequence?: number };
      const sequence = typeof sequenceRow.sequence === "number"
        ? sequenceRow.sequence + 1
        : 0;
      const event = toOpenResponsesRunEventV0({
        ...args.input,
        workspace_id: args.workspaceId,
        sequence,
      });
      db.prepare(`
        INSERT INTO ${OPENRESPONSES_EVENTS_SQLITE_TABLE} (
          workspace_id,
          run_id,
          sequence,
          event_type,
          payload_json,
          idempotency_key,
          created_at,
          offset
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.workspace_id,
        event.run_id,
        event.sequence,
        event.event_type,
        safeStringify(event.payload),
        event.idempotency_key,
        event.created_at,
        args.offset,
      );
      persistOutputItemsFromRunEvent(db, event);
      db.exec("COMMIT;");
      return { event, inserted: true };
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  };

  const publishOpenResponsesRunEvent = (event: OpenResponsesRunEventV0) => {
    const listeners = openResponsesRunEventListenersBySessionRun.get(
      openResponsesRunEventListenerKey(event.workspace_id, event.run_id),
    );
    if (!listeners || listeners.size === 0) return;
    for (const listener of listeners) {
      listener(event);
    }
  };

  const getCurrentSessionOffset = (
    sessionId: string,
    state?: SavedState,
  ): number => {
    const cached = sessionOffsetById.get(sessionId) ?? -1;
    const fromMeta = parseFiniteInteger(
      (state?.meta as { lastAppliedOffset?: unknown } | undefined)
        ?.lastAppliedOffset,
    ) ??
      parseFiniteInteger(
        (state?.meta as { lastAppliedEventSeq?: unknown } | undefined)
          ?.lastAppliedEventSeq,
      );
    let resolved = fromMeta ?? cached;
    try {
      const db = getSessionSqliteDb(sessionId, state);
      const maxWorkspaceRow = db.prepare(
        `SELECT MAX(offset) AS offset
         FROM ${WORKSPACE_EVENTS_SQLITE_TABLE}`,
      ).get() as { offset?: number };
      const maxRunEventRow = db.prepare(
        `SELECT MAX(offset) AS offset
         FROM ${OPENRESPONSES_EVENTS_SQLITE_TABLE}`,
      ).get() as { offset?: number };
      resolved = Math.max(
        resolved,
        parseFiniteInteger(maxWorkspaceRow.offset) ?? -1,
        parseFiniteInteger(maxRunEventRow.offset) ?? -1,
      );
    } catch {
      // sqlite may not exist yet for brand-new sessions
    }
    if (resolved === -1) {
      const records = listWorkspaceEnvelopes({
        workspaceId: getWorkspaceIdForState(sessionId, state),
        state,
        sessionId,
      });
      if (records.length > 0) {
        resolved = ensureMonotonicOffsets(
          records,
          `${
            getSessionSqlitePath(sessionId, state)
          }:${WORKSPACE_EVENTS_SQLITE_TABLE}`,
        );
      }
    }
    sessionOffsetById.set(sessionId, resolved);
    return resolved;
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

  const readBuildProjection = (workspaceId: string): BuildProjectionState => {
    const cached = buildProjectionCache.get(workspaceId);
    if (cached) return cached;
    const state = readSessionState(workspaceId);
    const sessionId = typeof state?.meta?.sessionId === "string"
      ? state.meta.sessionId
      : workspaceId;
    try {
      const db = getSessionSqliteDb(sessionId, state);
      const row = db.prepare(
        `SELECT projection_json
         FROM ${BUILD_PROJECTION_SQLITE_TABLE}
         WHERE workspace_id = ?`,
      ).get(workspaceId) as { projection_json?: string } | undefined;
      if (!row?.projection_json) {
        throw new Error("missing build projection");
      }
      const parsed = JSON.parse(row.projection_json) as Record<string, unknown>;
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

  const rebuildBuildProjectionFromEvents = (
    workspaceId: string,
  ) => {
    const state = readSessionState(workspaceId);
    const sessionId = typeof state?.meta?.sessionId === "string"
      ? state.meta.sessionId
      : workspaceId;
    const records = listWorkspaceEnvelopes({ workspaceId, state, sessionId });
    if (records.length > 0) {
      ensureMonotonicOffsets(
        records,
        `${
          getSessionSqlitePath(sessionId, state)
        }:${WORKSPACE_EVENTS_SQLITE_TABLE}`,
      );
    }
    const projection = replayBuildProjection(workspaceId, records);
    const db = getSessionSqliteDb(sessionId, state);
    db.prepare(
      `INSERT INTO ${BUILD_PROJECTION_SQLITE_TABLE} (
        workspace_id,
        projection_json,
        updated_at,
        last_applied_offset
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        projection_json = excluded.projection_json,
        updated_at = excluded.updated_at,
        last_applied_offset = excluded.last_applied_offset`,
    ).run(
      workspaceId,
      safeStringify(projection),
      new Date().toISOString(),
      projection.lastAppliedOffset,
    );
    buildProjectionCache.set(workspaceId, projection);
  };

  const appendWorkspaceEnvelope = (
    state: SavedState,
    eventType: WorkspaceEventDomain,
    data: Record<string, unknown>,
  ): WorkspaceEventEnvelope | null => {
    const sessionId = typeof state.meta?.sessionId === "string"
      ? state.meta.sessionId
      : undefined;
    if (!sessionId) return null;
    const workspaceId = getWorkspaceIdForState(sessionId, state);
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
      const db = getSessionSqliteDb(sessionId, state);
      db.prepare(
        `INSERT INTO ${WORKSPACE_EVENTS_SQLITE_TABLE} (
          workspace_id,
          offset,
          domain,
          created_at,
          payload_json
        ) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        workspaceId,
        offset,
        eventType,
        createdAt,
        safeStringify(normalizedData),
      );
      sessionOffsetById.set(sessionId, offset);
      if (state.meta && typeof state.meta === "object") {
        (state.meta as Record<string, unknown>).lastAppliedOffset = offset;
        (state.meta as Record<string, unknown>).lastAppliedEventSeq = offset;
        (state.meta as Record<string, unknown>).sessionUpdatedAt = createdAt;
      }
      writeWorkspaceStateRow({
        sessionId,
        state,
        updatedAt: createdAt,
      });
      if (eventType === "build") {
        await rebuildBuildProjectionFromEvents(workspaceId);
      }
    });
    return envelope;
  };

  const appendOpenResponsesRunEvent = async (
    state: SavedState,
    input: AppendOpenResponsesRunEventV0Input,
  ): Promise<OpenResponsesRunEventV0 | null> => {
    const sessionId = typeof state.meta?.sessionId === "string"
      ? state.meta.sessionId
      : undefined;
    const workspaceId = typeof state.meta?.workspaceId === "string"
      ? state.meta.workspaceId
      : sessionId;
    if (!sessionId || !workspaceId) return null;
    if (!isOpenResponsesRunEventPayload(input.payload)) {
      throw new Error("OpenResponses run event payload must include a type");
    }

    const store = getOpenResponsesRunEventStore(sessionId);
    hydrateOpenResponsesRunEvents(sessionId, state);
    const idempotencyStoreKey = openResponsesRunEventIdempotencyKey(
      workspaceId,
      input.run_id,
      input.idempotency_key,
    );
    const existing = store.byIdempotencyKey.get(idempotencyStoreKey);
    if (existing) return existing;
    return await enqueueSessionWriteResult(sessionId, () => {
      const localStore = getOpenResponsesRunEventStore(sessionId);
      hydrateOpenResponsesRunEvents(sessionId, state);
      const idempotent = localStore.byIdempotencyKey.get(idempotencyStoreKey);
      if (idempotent) {
        publishOpenResponsesRunEvent(idempotent);
        return idempotent;
      }
      const offset = nextSessionOffsetCandidate(sessionId, state);
      const { event, inserted } = appendOpenResponsesRunEventSqlite({
        sessionId,
        state,
        input,
        workspaceId,
        offset,
      });
      if (!inserted) {
        indexOpenResponsesRunEvent(localStore, event);
        publishOpenResponsesRunEvent(event);
        return event;
      }
      const db = getSessionSqliteDb(sessionId, state);
      db.prepare(
        `INSERT INTO ${WORKSPACE_EVENTS_SQLITE_TABLE} (
          workspace_id,
          offset,
          domain,
          created_at,
          payload_json
        ) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        workspaceId,
        offset,
        "session",
        event.created_at,
        safeStringify({
          ...event,
          offset,
          type: OPENRESPONSES_RUN_EVENT_RECORD_TYPE,
          _gambit: {
            kind: OPENRESPONSES_RUN_EVENT_RECORD_KIND,
            domain: "session",
            offset,
          },
        }),
      );
      sessionOffsetById.set(sessionId, offset);
      if (state.meta && typeof state.meta === "object") {
        (state.meta as Record<string, unknown>).lastAppliedOffset = offset;
        (state.meta as Record<string, unknown>).lastAppliedEventSeq = offset;
        (state.meta as Record<string, unknown>).sessionUpdatedAt =
          event.created_at;
      }
      writeWorkspaceStateRow({
        sessionId,
        state,
        updatedAt: event.created_at,
      });
      indexOpenResponsesRunEvent(localStore, event);
      publishOpenResponsesRunEvent(event);
      return event;
    });
  };

  const listOpenResponsesRunEvents = (args: {
    workspaceId: string;
    runId: string;
    fromSequence?: number;
  }): Array<OpenResponsesRunEventV0> => {
    const state = readSessionState(args.workspaceId);
    if (!state) return [];
    const sessionId = typeof state.meta?.sessionId === "string"
      ? state.meta.sessionId
      : args.workspaceId;
    const fromSequence = parseFiniteInteger(args.fromSequence) ?? 0;
    const db = getSessionSqliteDb(sessionId, state);
    const rows = db.prepare(`
      SELECT
        workspace_id,
        run_id,
        sequence,
        event_type,
        payload_json,
        idempotency_key,
        created_at
      FROM ${OPENRESPONSES_EVENTS_SQLITE_TABLE}
      WHERE workspace_id = ? AND run_id = ? AND sequence >= ?
      ORDER BY sequence ASC
    `).all(args.workspaceId, args.runId, fromSequence) as Array<{
      workspace_id: string;
      run_id: string;
      sequence: number;
      event_type: string;
      payload_json: string;
      idempotency_key: string;
      created_at: string;
    }>;
    return rows.flatMap((row) => {
      let payload: unknown = {};
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        return [];
      }
      if (!isOpenResponsesRunEventPayload(payload)) return [];
      return toOpenResponsesRunEventV0({
        workspace_id: row.workspace_id,
        run_id: row.run_id,
        sequence: row.sequence,
        event_type: row.event_type,
        payload,
        idempotency_key: row.idempotency_key,
        created_at: row.created_at,
      });
    });
  };

  const listOpenResponsesOutputItems = (args: {
    workspaceId: string;
    runId: string;
  }): Array<OpenResponsesOutputItemV0> => {
    const state = readSessionState(args.workspaceId);
    if (!state) return [];
    const sessionId = typeof state.meta?.sessionId === "string"
      ? state.meta.sessionId
      : args.workspaceId;
    const db = getSessionSqliteDb(sessionId, state);
    const feedbackByRef = new Map(
      (state.feedback ?? []).map((entry) => [entry.messageRefId, entry]),
    );
    const rows = db.prepare(`
      SELECT
        item_id,
        item_kind,
        role,
        content,
        message_ref_id,
        reasoning_type,
        summary,
        tool_call_id,
        tool_name,
        tool_status,
        arguments_text,
        result_text,
        error_text
      FROM ${OPENRESPONSES_OUTPUT_ITEMS_SQLITE_TABLE}
      WHERE workspace_id = ? AND run_id = ?
      ORDER BY sequence ASC, output_index ASC, item_key ASC
    `).all(args.workspaceId, args.runId) as Array<{
      item_id: string;
      item_kind: string;
      role: string | null;
      content: string | null;
      message_ref_id: string | null;
      reasoning_type: string | null;
      summary: string | null;
      tool_call_id: string | null;
      tool_name: string | null;
      tool_status: string | null;
      arguments_text: string | null;
      result_text: string | null;
      error_text: string | null;
    }>;
    return rows.flatMap<OpenResponsesOutputItemV0>((row) => {
      if (row.item_kind === "message") {
        const feedbackEligible = row.message_ref_id
          ? (
            isFeedbackEligibleMessageRef(state, row.message_ref_id) ||
            isFeedbackEligiblePersistedTestRunMessageRef(
              state,
              args.runId,
              row.message_ref_id,
            )
          )
          : false;
        return [{
          __typename: "OutputMessage" as const,
          id: row.item_id,
          role: row.role ?? "assistant",
          content: row.content ?? "",
          messageRefId: row.message_ref_id ?? undefined,
          feedbackEligible,
          feedback: row.message_ref_id
            ? feedbackByRef.get(row.message_ref_id) ?? undefined
            : undefined,
        }];
      }
      if (row.item_kind === "reasoning") {
        if (!(row.summary ?? "").trim()) return [];
        return [{
          __typename: "OutputReasoning" as const,
          id: row.item_id,
          summary: row.summary ?? "",
          reasoningType: row.reasoning_type ?? undefined,
        }];
      }
      if (row.item_kind === "tool_call") {
        const status = row.tool_status === "RUNNING" ||
            row.tool_status === "ERROR"
          ? row.tool_status
          : "COMPLETED";
        return [{
          __typename: "OutputToolCall" as const,
          id: row.item_id,
          toolCallId: row.tool_call_id ?? row.item_id,
          toolName: row.tool_name ?? "tool_call",
          status,
          argumentsText: row.arguments_text ?? undefined,
          resultText: row.result_text ?? undefined,
          error: row.error_text ?? undefined,
        }];
      }
      return [];
    });
  };

  const subscribeOpenResponsesRunEvents = (args: {
    workspaceId: string;
    runId: string;
    fromSequence?: number;
    signal?: AbortSignal;
  }): AsyncIterable<OpenResponsesRunEventV0> => {
    const replayFrom = parseFiniteInteger(args.fromSequence) ?? 0;
    return {
      async *[Symbol.asyncIterator]() {
        const listenerKey = openResponsesRunEventListenerKey(
          args.workspaceId,
          args.runId,
        );
        const listeners = openResponsesRunEventListenersBySessionRun.get(
          listenerKey,
        ) ??
          new Set<OpenResponsesRunEventSubscriptionListener>();
        openResponsesRunEventListenersBySessionRun.set(listenerKey, listeners);

        const pending: Array<OpenResponsesRunEventV0> = [];
        let wake: (() => void) | null = null;
        let highWatermark = replayFrom - 1;
        const wakeNow = () => {
          if (!wake) return;
          const resolve = wake;
          wake = null;
          resolve();
        };
        const listener: OpenResponsesRunEventSubscriptionListener = (event) => {
          if (event.sequence <= highWatermark) return;
          pending.push(event);
          pending.sort((a, b) => a.sequence - b.sequence);
          wakeNow();
        };
        listeners.add(listener);
        const abortListener = () => wakeNow();
        args.signal?.addEventListener("abort", abortListener, { once: true });

        try {
          const replay = listOpenResponsesRunEvents({
            workspaceId: args.workspaceId,
            runId: args.runId,
            fromSequence: replayFrom,
          });
          for (const event of replay) {
            if (event.sequence <= highWatermark) continue;
            highWatermark = event.sequence;
            yield event;
          }

          while (!args.signal?.aborted) {
            if (pending.length === 0) {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
              continue;
            }
            const next = pending.shift();
            if (!next || next.sequence <= highWatermark) continue;
            highWatermark = next.sequence;
            yield next;
          }
        } finally {
          args.signal?.removeEventListener("abort", abortListener);
          listeners.delete(listener);
          if (listeners.size === 0) {
            openResponsesRunEventListenersBySessionRun.delete(listenerKey);
          }
        }
      },
    };
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
    const sessionId = typeof state.meta?.sessionId === "string"
      ? state.meta.sessionId
      : typeof state.meta?.workspaceId === "string"
      ? state.meta.workspaceId
      : undefined;
    if (!sessionId) return [];
    try {
      const records = listWorkspaceEnvelopes({
        workspaceId: getWorkspaceIdForState(sessionId, state),
      });
      const traces: Array<TraceEvent> = [];
      for (const envelope of records) {
        const record = envelope.data;
        const kind = typeof record.kind === "string" ? record.kind : "";
        const type = typeof record.type === "string" ? record.type : "";
        if (kind === "trace" || isTraceEventType(type)) {
          const normalized = normalizePersistedTraceRecord(record);
          if (normalized) traces.push(normalized);
          continue;
        }
        const nestedEvent = isObjectRecord(record.event)
          ? normalizePersistedTraceRecord(record.event)
          : null;
        if (nestedEvent) {
          traces.push(nestedEvent);
          continue;
        }
        const run = isObjectRecord(record.run) ? record.run : null;
        const runTraces = Array.isArray(run?.traces) ? run.traces : [];
        for (const candidate of runTraces) {
          if (!isObjectRecord(candidate)) continue;
          const normalized = normalizePersistedTraceRecord(candidate);
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
      const sqlitePath = typeof snapshot.meta?.sessionSqlitePath === "string"
        ? snapshot.meta.sessionSqlitePath
        : path.join(dir, SESSION_SQLITE_DB_FILENAME);
      enqueueSessionWrite(sessionId, async () => {
        try {
          await ensureDirAsync(dir);
          const sqliteState: SavedState = {
            ...snapshot,
            meta: {
              ...(snapshot.meta ?? {}),
              sessionSqlitePath: sqlitePath,
            },
          };
          const db = getSessionSqliteDb(sessionId, sqliteState);
          const workspaceId = getWorkspaceIdForState(sessionId, sqliteState);
          if (!readWorkspaceStateRow(sessionId, sqliteState)) {
            const startOffset = nextSessionOffsetCandidate(sessionId, snapshot);
            db.prepare(
              `INSERT INTO ${WORKSPACE_EVENTS_SQLITE_TABLE} (
                workspace_id,
                offset,
                domain,
                created_at,
                payload_json
              ) VALUES (?, ?, ?, ?, ?)`,
            ).run(
              workspaceId,
              startOffset,
              "session",
              new Date().toISOString(),
              safeStringify({
                type: "gambit.session.start",
                _gambit: {
                  legacy_type: "session.start",
                  domain: "session",
                },
                category: "lifecycle",
                sessionId,
                runId: snapshot.runId,
                deck: snapshot.meta?.deck,
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
              sessionSqlitePath: sqlitePath,
            },
          };
          db.prepare(
            `INSERT INTO ${WORKSPACE_EVENTS_SQLITE_TABLE} (
              workspace_id,
              offset,
              domain,
              created_at,
              payload_json
            ) VALUES (?, ?, ?, ?, ?)`,
          ).run(
            workspaceId,
            snapshotOffset,
            "session",
            new Date().toISOString(),
            safeStringify({
              type: "session.snapshot",
              category: "snapshot",
              sessionId,
              runId: snapshotToWrite.runId,
              state: snapshotToWrite,
            }),
          );
          sessionOffsetById.set(sessionId, snapshotOffset);
          writeWorkspaceStateRow({
            sessionId,
            state: snapshotToWrite,
          });
          await rebuildBuildProjectionFromEvents(workspaceId);
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
    const sqlitePath = path.join(dir, SESSION_SQLITE_DB_FILENAME);
    let parsed: SavedState | null = null;
    const row = readWorkspaceStateRow(
      sessionId,
      {
        runId: sessionId,
        messages: [],
        meta: {
          sessionId,
          workspaceId: sessionId,
          sessionDir: dir,
          sessionSqlitePath: sqlitePath,
        },
      },
    );
    if (typeof row?.state_json === "string") {
      parsed = JSON.parse(row.state_json) as SavedState;
      const lastAppliedOffset = parseFiniteInteger(row.last_applied_offset) ??
        -1;
      sessionOffsetById.set(sessionId, lastAppliedOffset);
    } else {
      throw new Deno.errors.NotFound(`Workspace ${sessionId} was not found`);
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Invalid workspace state payload for ${sessionId}`);
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
    if (typeof meta.sessionSqlitePath !== "string") {
      meta.sessionSqlitePath = sqlitePath;
    }

    const records = listWorkspaceEnvelopes({
      workspaceId: typeof meta.workspaceId === "string"
        ? meta.workspaceId
        : sessionId,
    });
    if (records.length > 0) {
      const lastAppliedOffset = ensureMonotonicOffsets(
        records,
        `${sqlitePath}:${WORKSPACE_EVENTS_SQLITE_TABLE}`,
      );
      meta.lastAppliedOffset = lastAppliedOffset;
      meta.lastAppliedEventSeq = lastAppliedOffset;
      sessionOffsetById.set(sessionId, lastAppliedOffset);
    } else if (typeof meta.lastAppliedOffset !== "number") {
      meta.lastAppliedOffset = -1;
      meta.lastAppliedEventSeq = -1;
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
    const projection = readBuildProjection(workspaceId);
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
        const task = Promise.resolve().then(() => {
          rebuildBuildProjectionFromEvents(workspaceId);
        }).catch((err: unknown) => {
          logger.warn(
            `[sim] failed to refresh build projection for ${workspaceId}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }).finally(() => {
          buildProjectionRefreshInFlight.delete(workspaceId);
        });
        buildProjectionRefreshInFlight.set(workspaceId, task);
      }
    }
    return projection;
  };

  return {
    parseFiniteInteger,
    selectCanonicalScenarioRunSummary,
    appendWorkspaceEnvelope,
    appendOpenResponsesRunEvent,
    appendSessionEvent,
    appendFeedbackLog,
    appendGradingLog,
    appendErrorLog,
    appendServerErrorLog,
    persistSessionState,
    readSessionStateStrict,
    readSessionState,
    readWorkspaceDeckState,
    readBuildState,
    listWorkspaceEnvelopes,
    listOpenResponsesRunEvents,
    listOpenResponsesOutputItems,
    subscribeOpenResponsesRunEvents,
    writeWorkspaceDeckState,
    replayBuildProjection,
  };
};
