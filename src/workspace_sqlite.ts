import * as path from "@std/path";
import { DatabaseSync } from "node:sqlite";
import type { SavedState, TraceEvent } from "@bolt-foundry/gambit-core";

export const WORKSPACE_SQLITE_FILENAME = "workspace.sqlite";
const STANDALONE_SCHEMA_VERSION = 7;

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

function isTraceEventType(type: string): boolean {
  if (TRACE_EVENT_TYPES.has(type)) return true;
  if (type.startsWith("response.")) return true;
  if (type.startsWith("gambit.")) {
    return TRACE_EVENT_TYPES.has(type.slice("gambit.".length));
  }
  return false;
}

function normalizePersistedTraceRecord(
  record: Record<string, unknown>,
): TraceEvent | null {
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
}

export function resolveWorkspaceSqlitePath(
  inputPath: string,
): string | undefined {
  const candidate = normalizeWorkspaceSqlitePath(inputPath);
  try {
    const stat = Deno.statSync(candidate);
    return stat.isFile ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeWorkspaceSqlitePath(inputPath: string): string {
  const normalized = path.resolve(inputPath);
  return path.basename(normalized) === WORKSPACE_SQLITE_FILENAME
    ? normalized
    : path.join(path.dirname(normalized), WORKSPACE_SQLITE_FILENAME);
}

export function readWorkspaceStateFromSqlite(
  sqlitePath: string,
  workspaceId?: string,
): { workspaceId: string; state: SavedState } | null {
  const db = new DatabaseSync(sqlitePath);
  try {
    const row = workspaceId
      ? db.prepare(
        `SELECT workspace_id, state_json
         FROM workspace_state_v0
         WHERE workspace_id = ?`,
      ).get(workspaceId)
      : db.prepare(
        `SELECT workspace_id, state_json
         FROM workspace_state_v0
         ORDER BY workspace_id ASC
         LIMIT 1`,
      ).get();
    const record = row as
      | { workspace_id?: string; state_json?: string }
      | undefined;
    if (
      typeof record?.workspace_id !== "string" ||
      typeof record.state_json !== "string"
    ) {
      return null;
    }
    return {
      workspaceId: record.workspace_id,
      state: JSON.parse(record.state_json) as SavedState,
    };
  } finally {
    db.close();
  }
}

function ensureStandaloneWorkspaceSqlite(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS openresponses_run_events_v0 (
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
    CREATE INDEX IF NOT EXISTS openresponses_run_events_v0_workspace_run_sequence_idx
      ON openresponses_run_events_v0(workspace_id, run_id, sequence);
    CREATE INDEX IF NOT EXISTS openresponses_run_events_v0_workspace_run_idempotency_idx
      ON openresponses_run_events_v0(workspace_id, run_id, idempotency_key);
    CREATE TABLE IF NOT EXISTS openresponses_output_items_v0 (
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
    CREATE INDEX IF NOT EXISTS openresponses_output_items_v0_workspace_run_sequence_idx
      ON openresponses_output_items_v0(workspace_id, run_id, sequence);
    CREATE TABLE IF NOT EXISTS workspace_state_v0 (
      workspace_id TEXT NOT NULL PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_applied_offset INTEGER NOT NULL DEFAULT -1
    );
    CREATE TABLE IF NOT EXISTS workspace_deck_state_v0 (
      workspace_id TEXT NOT NULL PRIMARY KEY,
      root_deck_path TEXT NOT NULL,
      assistant_deck_json TEXT NOT NULL,
      scenario_decks_json TEXT NOT NULL,
      grader_decks_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_events_v0 (
      workspace_id TEXT NOT NULL,
      offset INTEGER NOT NULL,
      domain TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (workspace_id, offset)
    );
    CREATE INDEX IF NOT EXISTS workspace_events_v0_workspace_domain_offset_idx
      ON workspace_events_v0(workspace_id, domain, offset);
    CREATE TABLE IF NOT EXISTS build_projection_v0 (
      workspace_id TEXT NOT NULL PRIMARY KEY,
      projection_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_applied_offset INTEGER NOT NULL DEFAULT -1
    );
    PRAGMA user_version = ${STANDALONE_SCHEMA_VERSION};
  `);
}

function resolveWorkspaceIdFromPath(
  state: SavedState,
  sqlitePath: string,
): string {
  const meta = state.meta ?? {};
  if (
    typeof meta.workspaceId === "string" && meta.workspaceId.trim().length > 0
  ) {
    return meta.workspaceId;
  }
  if (typeof meta.sessionId === "string" && meta.sessionId.trim().length > 0) {
    return meta.sessionId;
  }
  const dir = path.dirname(path.resolve(sqlitePath));
  return path.basename(dir);
}

export function saveCanonicalWorkspaceState(
  sqlitePath: string,
  state: SavedState,
): { sqlitePath: string; workspaceId: string; state: SavedState } {
  const resolvedPath = normalizeWorkspaceSqlitePath(sqlitePath);
  Deno.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const workspaceId = resolveWorkspaceIdFromPath(state, resolvedPath);
  const nextState: SavedState = {
    ...state,
    meta: {
      ...(state.meta ?? {}),
      workspaceId,
      sessionId: typeof state.meta?.sessionId === "string"
        ? state.meta.sessionId
        : workspaceId,
      sessionDir: path.dirname(resolvedPath),
      sessionSqlitePath: resolvedPath,
    },
  };
  const db = new DatabaseSync(resolvedPath);
  try {
    ensureStandaloneWorkspaceSqlite(db);
    const lastAppliedOffset =
      typeof nextState.meta?.lastAppliedOffset === "number"
        ? nextState.meta.lastAppliedOffset
        : typeof nextState.meta?.lastAppliedEventSeq === "number"
        ? nextState.meta.lastAppliedEventSeq
        : -1;
    db.prepare(
      `INSERT INTO workspace_state_v0 (
        workspace_id, state_json, updated_at, last_applied_offset
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at,
        last_applied_offset = excluded.last_applied_offset`,
    ).run(
      workspaceId,
      JSON.stringify(nextState),
      new Date().toISOString(),
      lastAppliedOffset,
    );
  } finally {
    db.close();
  }
  return { sqlitePath: resolvedPath, workspaceId, state: nextState };
}

export function loadCanonicalWorkspaceState(
  inputPath: string,
): { workspaceId: string; state: SavedState; sqlitePath?: string } {
  const sqlitePath = resolveWorkspaceSqlitePath(inputPath);
  if (!sqlitePath) {
    throw new Error(
      `Workspace sqlite not found. Expected ${WORKSPACE_SQLITE_FILENAME} near: ${inputPath}`,
    );
  }
  const sqliteState = readWorkspaceStateFromSqlite(sqlitePath);
  if (!sqliteState) {
    throw new Error(
      `Workspace state not found or invalid in sqlite: ${sqlitePath}`,
    );
  }
  return {
    ...sqliteState,
    sqlitePath,
  };
}

export function loadTraceEventsFromWorkspaceSqlite(
  sqlitePath: string,
  workspaceId: string,
): Array<TraceEvent> {
  const db = new DatabaseSync(sqlitePath);
  try {
    const rows = db.prepare(
      `SELECT payload_json
       FROM workspace_events_v0
       WHERE workspace_id = ?
       ORDER BY offset ASC`,
    ).all(workspaceId) as Array<{ payload_json?: string }>;
    const traces: Array<TraceEvent> = [];
    for (const row of rows) {
      if (typeof row.payload_json !== "string") continue;
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        continue;
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        continue;
      }
      const record = payload as Record<string, unknown>;
      const kind = typeof record.kind === "string" ? record.kind : "";
      const type = typeof record.type === "string" ? record.type : "";
      if (kind === "trace" || isTraceEventType(type)) {
        const normalized = normalizePersistedTraceRecord(record);
        if (normalized) traces.push(normalized);
        continue;
      }
      const nested = record.event;
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
        continue;
      }
      const normalized = normalizePersistedTraceRecord(
        nested as Record<string, unknown>,
      );
      if (normalized) traces.push(normalized);
    }
    return traces;
  } finally {
    db.close();
  }
}

export function exportWorkspaceEventsJsonlFromSqlite(
  sqlitePath: string,
  workspaceId: string,
): string {
  const db = new DatabaseSync(sqlitePath);
  try {
    const rows = db.prepare(
      `SELECT offset, domain, created_at, payload_json
       FROM workspace_events_v0
       WHERE workspace_id = ?
       ORDER BY offset ASC`,
    ).all(workspaceId) as Array<{
      offset?: number;
      domain?: string;
      created_at?: string;
      payload_json?: string;
    }>;
    const lines = rows.flatMap((row) => {
      if (
        typeof row.offset !== "number" || typeof row.domain !== "string" ||
        typeof row.created_at !== "string" ||
        typeof row.payload_json !== "string"
      ) {
        return [];
      }
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        return [];
      }
      return [JSON.stringify({
        offset: row.offset,
        createdAt: row.created_at,
        type: row.domain,
        data: payload,
      })];
    });
    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
  } finally {
    db.close();
  }
}

export function rewriteWorkspaceStateMetaInSqlite(args: {
  sqlitePath: string;
  workspaceId: string;
  mutate: (state: SavedState) => SavedState;
}): void {
  const current = readWorkspaceStateFromSqlite(
    args.sqlitePath,
    args.workspaceId,
  );
  if (!current) {
    throw new Error(
      `Workspace ${args.workspaceId} is missing canonical sqlite state.`,
    );
  }
  const nextState = args.mutate(current.state);
  const db = new DatabaseSync(args.sqlitePath);
  try {
    db.prepare(
      `UPDATE workspace_state_v0
       SET state_json = ?, updated_at = ?
       WHERE workspace_id = ?`,
    ).run(
      JSON.stringify(nextState),
      new Date().toISOString(),
      args.workspaceId,
    );
  } finally {
    db.close();
  }
}

export function rewriteWorkspaceDeckRootInSqlite(args: {
  sqlitePath: string;
  workspaceId: string;
  rootDeckPath: string;
}): void {
  const db = new DatabaseSync(args.sqlitePath);
  try {
    db.prepare(
      `UPDATE workspace_deck_state_v0
       SET root_deck_path = ?, updated_at = ?
       WHERE workspace_id = ?`,
    ).run(args.rootDeckPath, new Date().toISOString(), args.workspaceId);
  } finally {
    db.close();
  }
}
