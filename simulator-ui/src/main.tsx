import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

type NormalizedSchema = {
  kind:
    | "string"
    | "number"
    | "boolean"
    | "enum"
    | "object"
    | "array"
    | "unknown";
  optional: boolean;
  description?: string;
  example?: unknown;
  defaultValue?: unknown;
  enumValues?: Array<unknown>;
  fields?: Record<string, NormalizedSchema>;
  items?: NormalizedSchema;
};

type SchemaResponse = {
  deck?: string;
  schema?: NormalizedSchema;
  defaults?: unknown;
  error?: string;
};

type ModelMessage = {
  role: string;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type MessageRef = { id: string; role: string };

type FeedbackEntry = {
  id: string;
  runId: string;
  messageRefId: string;
  score: number;
  reason?: string;
  createdAt?: string;
};

type SavedState = {
  runId: string;
  messages: ModelMessage[];
  messageRefs?: MessageRef[];
  feedback?: FeedbackEntry[];
  traces?: TraceEvent[];
  notes?: SessionNotes;
  conversationScore?: SessionRating;
  meta?: Record<string, unknown>;
};

type SessionNotes = {
  text?: string;
  updatedAt?: string;
};

type SessionRating = {
  score: number;
  updatedAt?: string;
};

type TraceEvent = {
  type?: string;
  runId?: string;
  deckPath?: string;
  message?: ModelMessage;
  [key: string]: unknown;
};

type SessionMeta = {
  id: string;
  deck?: string;
  deckSlug?: string;
  createdAt?: string;
};

type SimulatorMessage =
  | {
    type: "ready";
    deck?: string;
    port?: number;
    schema?: NormalizedSchema;
    defaults?: unknown;
    schemaError?: string;
  }
  | { type: "state"; state: SavedState }
  | { type: "trace"; event: TraceEvent }
  | { type: "stream"; chunk: string; runId?: string }
  | { type: "pong" }
  | { type: "error"; message: string };

const SCORE_VALUES = [-3, -2, -1, 0, 1, 2, 3];

const deckPath = (window as unknown as { __GAMBIT_DECK_PATH__?: string })
  .__GAMBIT_DECK_PATH__ ?? "Unknown deck";

const globalStyles = `
:root {
  color-scheme: light;
  font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
body {
  margin: 0;
  background: #f6f7fb;
}
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 24px;
  gap: 16px;
}
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.app-header h1 {
  margin: 0;
  font-size: 24px;
}
.deck-path {
  font-family: monospace;
  font-size: 13px;
  color: #475569;
}
.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.header-actions button {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 8px 14px;
  background: white;
  cursor: pointer;
  font-weight: 600;
}
.header-actions button.primary {
  background: #0b93f6;
  color: white;
  border-color: #0b93f6;
}
.status-indicator {
  text-transform: capitalize;
  font-size: 13px;
  color: #475569;
}
.status-indicator.connected {
  color: #0f9d58;
}
.app-main {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
}
.chat-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #ffffff;
  border-radius: 16px;
  padding: 16px;
  border: 1px solid #e2e8f0;
  max-height: 70vh;
  overflow-y: auto;
}
.chat-row {
  display: flex;
  justify-content: flex-start;
}
.bubble {
  background: #f1f5f9;
  border-radius: 16px;
  padding: 12px;
  width: 100%;
  box-shadow: inset 0 0 0 1px #e2e8f0;
}
.bubble-user {
  background: #0b93f6;
  color: white;
  box-shadow: none;
}
.bubble-role {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  margin-bottom: 6px;
}
.bubble-user .bubble-role {
  color: rgba(255,255,255,0.7);
}
.bubble-text {
  line-height: 1.5;
}
.bubble-json {
  background: rgba(0,0,0,0.04);
  padding: 8px;
  border-radius: 8px;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.feedback-controls {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  opacity: 0.25;
  transition: opacity 120ms ease-in-out;
}
.bubble:hover .feedback-controls,
.feedback-controls:focus-within {
  opacity: 1;
}
.feedback-scores {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.score-button {
  border: 1px solid #cbd5e1;
  background: white;
  border-radius: 8px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
.score-button-active {
  background: #0b93f6;
  color: white;
  border-color: #0b93f6;
}
.feedback-reason {
  width: 100%;
  min-height: 48px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  padding: 8px;
  resize: vertical;
  box-sizing: border-box;
  font-family: inherit;
}
.feedback-meta {
  font-size: 11px;
  color: #475569;
}
.feedback-status {
  font-size: 11px;
  color: #94a3b8;
}
.feedback-status.saving {
  color: #0b93f6;
}
.feedback-status.unsaved {
  color: #b45309;
}
.init-panel {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
  padding: 12px;
  margin-bottom: 12px;
}
.init-panel summary {
  cursor: pointer;
  font-weight: 700;
  color: #0f172a;
}
.init-panel .hint {
  margin-top: 6px;
  font-size: 12px;
  color: #475569;
}
.init-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.init-field {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.init-field label {
  font-weight: 700;
  color: #111827;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}
.init-field input,
.init-field select,
.init-field textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 8px;
  box-sizing: border-box;
  font-family: inherit;
}
.init-field textarea {
  min-height: 80px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
.init-summary-json {
  margin-top: 10px;
  background: rgba(15, 23, 42, 0.06);
  border-radius: 12px;
  padding: 10px;
  overflow-x: auto;
  font-size: 12px;
}
.init-missing {
  margin-top: 8px;
  font-size: 12px;
  color: #b91c1c;
}
.init-controls {
  margin-top: 10px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.secondary-note {
  font-size: 12px;
  color: #475569;
}
.trace-panel {
  background: white;
  border-radius: 16px;
  padding: 16px;
  border: 1px solid #e2e8f0;
  height: 70vh;
  overflow-y: auto;
}
.trace-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.trace-row {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 8px;
  background: #f8fafc;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.trace-json {
  font-size: 11px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.composer {
  background: white;
  padding: 12px;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.composer-inputs {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.message-input {
  width: 100%;
  min-height: 80px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  padding: 10px;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}
.notes-inline {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.notes-inline header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.notes-inline label {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.notes-inline textarea {
  width: 100%;
  min-height: 80px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  padding: 10px;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}
.notes-inline-status {
  font-size: 12px;
  color: #475569;
}
.notes-inline-status .state {
  font-weight: 600;
}
.notes-inline-status .state.saving {
  color: #0b93f6;
}
.notes-inline-status .state.unsaved {
  color: #b45309;
}
.notes-inline-status .state.idle {
  color: #94a3b8;
}
.notes-inline-status .state.saved {
  color: #0f9d58;
}
.rating-controls {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.rating-label {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.rating-status {
  font-size: 12px;
  color: #475569;
}
.rating-button {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  background: white;
  cursor: pointer;
}
.rating-button.active {
  background: #0b93f6;
  color: white;
  border-color: #0b93f6;
}
.composer-actions {
  display: flex;
  gap: 10px;
}
.composer-actions button {
  padding: 10px 18px;
  border-radius: 10px;
  border: none;
  background: #0b93f6;
  color: white;
  font-weight: 600;
  cursor: pointer;
}
.reset-note {
  font-size: 12px;
  color: #b45309;
}
.error {
  color: #b91c1c;
  font-size: 13px;
}
.session-meta {
  font-size: 12px;
  color: #475569;
}
.sessions-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15,23,42,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.sessions-dialog {
  background: white;
  border-radius: 16px;
  padding: 20px;
  width: min(520px, 90%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sessions-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
.sessions-dialog header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sessions-dialog ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sessions-dialog li button {
  width: 100%;
  text-align: left;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px;
  background: #f8fafc;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sessions-dialog li button:hover {
  background: #e2e8f0;
}
.trace-empty, .empty-state {
  padding: 12px;
  color: #475569;
  text-align: center;
}
.recent-sessions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.recent-session-button {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px;
  background: #f8fafc;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.recent-session-button:hover {
  background: #e2e8f0;
}
.empty-state-actions {
  margin-top: 12px;
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
`;
const globalStyleEl = document.createElement("style");
globalStyleEl.textContent = globalStyles;
document.head.appendChild(globalStyleEl);

function useSimulator() {
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "closed" | "error"
  >("connecting");
  const [savedState, setSavedState] = useState<SavedState | null>(null);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const [connectSeq, setConnectSeq] = useState(0);
  const [readySeq, setReadySeq] = useState(0);
  const [schemaResponse, setSchemaResponse] = useState<SchemaResponse | null>(
    null,
  );

  const wsUrl = useMemo(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${window.location.host}/websocket`;
  }, []);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setConnectionStatus("connecting");

    ws.onopen = () => {
      setConnectionStatus("connected");
      setErrors([]);
    };

    ws.onclose = () => {
      setConnectionStatus("closed");
    };

    ws.onerror = () => {
      setConnectionStatus("error");
      setErrors((prev) => [...prev, "WebSocket connection error"]);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as SimulatorMessage;
        if (msg.type === "ready") {
          setReadySeq((prev) => prev + 1);
          setSchemaResponse({
            deck: msg.deck,
            schema: msg.schema,
            defaults: msg.defaults,
            error: msg.schemaError,
          });
        } else if (msg.type === "state") {
          setSavedState(msg.state);
          if (Array.isArray(msg.state.traces)) {
            setTraceEvents(msg.state.traces as TraceEvent[]);
          }
        } else if (msg.type === "trace" && msg.event) {
          setTraceEvents((prev) => [...prev, msg.event].slice(-200));
        } else if (msg.type === "error") {
          setErrors((prev) => [...prev, msg.message ?? "Unknown error"]);
        }
      } catch (err) {
        console.error("[sim] failed to parse message", err);
      }
    };

    return () => {
      ws.close();
    };
  }, [wsUrl, connectSeq]);

  const send = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }, []);

  const run = useCallback(
    (opts: {
      input?: unknown;
      message?: string;
      resetState?: boolean;
      trace?: boolean;
    }) => {
      send({
        type: "run",
        stream: true,
        trace: opts.trace ?? true,
        input: opts.input,
        message: opts.message,
        resetState: opts.resetState ?? false,
      });
    },
    [send],
  );

  const sendFeedback = useCallback(
    (messageRefId: string, score: number, reason?: string) => {
      send({ type: "feedback", messageRefId, score, reason });
    },
    [send],
  );

  const loadSession = useCallback((sessionId: string) => {
    send({ type: "loadSession", sessionId });
  }, [send]);

  const saveNotes = useCallback((text: string) => {
    send({ type: "notes", text });
  }, [send]);

  const saveSessionScore = useCallback((score: number) => {
    send({ type: "conversationScore", score });
  }, [send]);

  const reconnect = useCallback(() => {
    const ws = wsRef.current;
    ws?.close();
    setConnectSeq((prev) => prev + 1);
  }, []);

  const resetLocal = useCallback(() => {
    setSavedState(null);
    setTraceEvents([]);
    setErrors([]);
  }, []);

  return {
    connectionStatus,
    savedState,
    traceEvents,
    errors,
    schemaResponse,
    readySeq,
    run,
    sendFeedback,
    loadSession,
    saveNotes,
    saveSessionScore,
    reconnect,
    resetLocal,
  };
}

function useSessions() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/sessions");
      if (!res.ok) throw new Error(res.statusText);
      const body = await res.json() as { sessions?: SessionMeta[] };
      setSessions(body.sessions ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load sessions",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  return { sessions, loading, error, refresh };
}

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatTimestamp(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function toDeckSlug(input: string): string {
  const base = input?.split(/[/\\]/).pop() || "deck";
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const slug = withoutExt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return slug || "session";
}

function getSessionIdFromPath(pathname?: string): string | null {
  const target = typeof pathname === "string"
    ? pathname
    : window.location.pathname;
  const match = target.match(/^\/sessions\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function cloneValue<T>(value: T): T {
  try {
    // @ts-ignore structuredClone is available in modern browsers
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function getPathValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (
      !current || typeof current !== "object" ||
      !(segment in (current as Record<string, unknown>))
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setPathValue(
  value: unknown,
  path: string[],
  nextValue: unknown,
): unknown {
  if (path.length === 0) return nextValue;
  const root = value && typeof value === "object"
    ? cloneValue(value as unknown)
    : {};
  let cursor = root as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const existing = cursor[segment];
    const next = existing && typeof existing === "object"
      ? cloneValue(existing as unknown)
      : {};
    cursor[segment] = next;
    cursor = next as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (nextValue === undefined) {
    delete cursor[last];
  } else {
    cursor[last] = nextValue;
  }
  return root;
}

function deriveInitialFromSchema(schema?: NormalizedSchema): unknown {
  if (!schema) return undefined;
  if (schema.defaultValue !== undefined) return cloneValue(schema.defaultValue);
  if (schema.example !== undefined) return cloneValue(schema.example);
  switch (schema.kind) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.fields ?? {})) {
        const v = deriveInitialFromSchema(child);
        if (v !== undefined) out[key] = v;
      }
      return Object.keys(out).length ? out : {};
    }
    case "array": {
      const item = schema.items
        ? deriveInitialFromSchema(schema.items)
        : undefined;
      return item !== undefined ? [item] : [];
    }
    case "boolean":
      return false;
    case "number":
      return undefined;
    case "string":
    case "unknown":
    case "enum":
    default:
      return undefined;
  }
}

function flattenSchemaLeaves(
  schema?: NormalizedSchema,
  prefix: string[] = [],
): Array<{ path: string[]; schema: NormalizedSchema }> {
  if (!schema) return [];
  if (schema.kind === "object" && schema.fields) {
    const out: Array<{ path: string[]; schema: NormalizedSchema }> = [];
    for (const [key, child] of Object.entries(schema.fields)) {
      out.push(...flattenSchemaLeaves(child, [...prefix, key]));
    }
    return out;
  }
  return [{ path: prefix, schema }];
}

function findMissingRequiredFields(
  schema: NormalizedSchema | undefined,
  value: unknown,
  prefix: string[] = [],
): string[] {
  if (!schema) return [];
  if (schema.optional) return [];

  if (schema.kind === "object" && schema.fields) {
    const missing: string[] = [];
    const asObj = value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
    for (const [key, child] of Object.entries(schema.fields)) {
      missing.push(
        ...findMissingRequiredFields(
          child,
          asObj ? asObj[key] : undefined,
          [...prefix, key],
        ),
      );
    }
    return missing;
  }

  const key = prefix.join(".") || "(root)";
  if (value === undefined || value === null) return [key];

  switch (schema.kind) {
    case "string": {
      if (typeof value !== "string") return [key];
      if (value.trim() === "") return [key];
      return [];
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? [] : [key];
    case "boolean":
      return typeof value === "boolean" ? [] : [key];
    case "enum":
      return value === "" ? [key] : [];
    case "array":
      return Array.isArray(value) && value.length > 0 ? [] : [key];
    case "unknown":
      return [];
    default:
      return [];
  }
}

function extractInitFromTraces(traces?: TraceEvent[]): unknown | undefined {
  if (!Array.isArray(traces)) return undefined;
  for (const event of traces) {
    if (event?.type === "run.start" && "input" in event) {
      const input = (event as { input?: unknown }).input;
      if (input !== undefined) return input;
    }
  }
  return undefined;
}

type ConversationMessage = {
  id?: string;
  message: ModelMessage;
  feedback?: FeedbackEntry;
};

function ConversationView(props: {
  messages: ConversationMessage[];
  header?: React.ReactNode;
  onScore: (messageRefId: string, score: number) => void;
  onReasonChange: (messageRefId: string, score: number, reason: string) => void;
  emptyState?: React.ReactNode;
}) {
  const { messages, header, onScore, onReasonChange, emptyState } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length]);

  return (
    <div className="chat-column" ref={containerRef}>
      {header}
      {messages.map((entry, idx) => (
        <MessageBubble
          key={entry.id ?? idx}
          entry={entry}
          onScore={onScore}
          onReasonChange={onReasonChange}
        />
      ))}
      {messages.length === 0 && (
        emptyState ?? (
          <div className="empty-state">
            <p>No conversation yet. Start a new chat to begin testing.</p>
          </div>
        )
      )}
    </div>
  );
}

function MessageBubble(props: {
  entry: ConversationMessage;
  onScore: (messageRefId: string, score: number) => void;
  onReasonChange: (messageRefId: string, score: number, reason: string) => void;
}) {
  const { entry, onScore, onReasonChange } = props;
  const role = entry.message.role;
  const isTool = role === "tool";
  const className = classNames(
    "bubble",
    role === "user" ? "bubble-user" : "bubble-assistant",
  );
  const messageRefId = entry.id;
  const content = entry.message.content ?? "";
  return (
    <div className="chat-row">
      <div className={className}>
        <div className="bubble-role">{role}</div>
        {content && !isTool && (
          <div
            className="bubble-text"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        )}
        {content && isTool && (
          <pre className="bubble-json">
            {content}
          </pre>
        )}
        {!content && entry.message.tool_calls && (
          <pre className="bubble-json">
            {JSON.stringify(entry.message.tool_calls, null, 2)}
          </pre>
        )}
        {messageRefId && role !== "user" && (
          <FeedbackControls
            messageRefId={messageRefId}
            feedback={entry.feedback}
            onScore={onScore}
            onReasonChange={onReasonChange}
          />
        )}
      </div>
    </div>
  );
}

function renderMarkdown(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(
    /\n/g,
    "<br />",
  );
}

function FeedbackControls(props: {
  messageRefId: string;
  feedback?: FeedbackEntry;
  onScore: (messageRefId: string, score: number) => void;
  onReasonChange: (messageRefId: string, score: number, reason: string) => void;
}) {
  const { messageRefId, feedback, onScore, onReasonChange } = props;
  const [reason, setReason] = useState(feedback?.reason ?? "");
  const [opened, setOpened] = useState(false);
  const [localScore, setLocalScore] = useState<number | null>(null);
  const [status, setStatus] = useState<
    "idle" | "unsaved" | "saving" | "saved"
  >("idle");
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    setReason(feedback?.reason ?? "");
    if (feedback?.reason !== undefined) {
      setStatus("saved");
    } else {
      setStatus("idle");
    }
  }, [feedback?.reason]);

  useEffect(() => {
    if (typeof feedback?.score === "number") {
      setLocalScore(feedback.score);
      setOpened(true);
    }
  }, [feedback?.score]);

  const effectiveScore = typeof feedback?.score === "number"
    ? feedback.score
    : localScore;

  useEffect(() => {
    if (typeof effectiveScore !== "number") return;
    if (status !== "unsaved") return;
    const handle = window.setTimeout(() => {
      setStatus("saving");
      lastSentRef.current = reason;
      onReasonChange(messageRefId, effectiveScore, reason);
    }, 650);
    return () => window.clearTimeout(handle);
  }, [effectiveScore, status, reason, onReasonChange, messageRefId]);

  useEffect(() => {
    if (status !== "saving") return;
    if (feedback?.reason === reason && lastSentRef.current === reason) {
      setStatus("saved");
    }
  }, [status, feedback?.reason, reason]);

  const showReason = opened ||
    typeof effectiveScore === "number" ||
    (feedback?.reason !== undefined && feedback.reason.length > 0);

  return (
    <div className="feedback-controls">
      <div className="feedback-scores">
        {SCORE_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            className={classNames(
              "score-button",
              effectiveScore === value && "score-button-active",
            )}
            onClick={() => {
              setOpened(true);
              setLocalScore(value);
              onScore(messageRefId, value);
            }}
          >
            {value}
          </button>
        ))}
      </div>
      {showReason && (
        <>
          <textarea
            className="feedback-reason"
            placeholder="Why?"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setStatus("unsaved");
            }}
            onBlur={() => {
              if (typeof effectiveScore !== "number") return;
              if (status !== "unsaved") return;
              setStatus("saving");
              lastSentRef.current = reason;
              onReasonChange(messageRefId, effectiveScore, reason);
            }}
          />
          <div
            className={classNames(
              "feedback-status",
              status === "saving" && "saving",
              status === "unsaved" && "unsaved",
            )}
          >
            {status === "saving" && "Saving…"}
            {status === "saved" && "Saved"}
            {status === "unsaved" && "Unsaved changes…"}
          </div>
        </>
      )}
    </div>
  );
}

function TraceList(props: { traces: TraceEvent[] }) {
  const { traces } = props;
  const ordered = traces;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const entries = useMemo(() => {
    const depthMap = new Map<string, number>();
    return ordered.map((trace) => {
      let depth = 0;
      if (
        "actionCallId" in trace &&
        typeof trace.actionCallId === "string"
      ) {
        const parentId = "parentActionCallId" in trace &&
            typeof trace.parentActionCallId === "string" &&
            trace.parentActionCallId.length
          ? trace.parentActionCallId
          : undefined;
        if (trace.type === "deck.start" || trace.type === "action.start") {
          const parentDepth = parentId && depthMap.has(parentId)
            ? depthMap.get(parentId)!
            : -1;
          depth = parentDepth + 1;
          depthMap.set(trace.actionCallId, depth);
        } else {
          const existing = depthMap.get(trace.actionCallId);
          if (existing !== undefined) {
            depth = existing;
          } else if (parentId && depthMap.has(parentId)) {
            depth = depthMap.get(parentId)! + 1;
          }
        }
      }
      return { trace, depth };
    });
  }, [ordered]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [traces.length]);

  return (
    <div className="trace-panel" ref={panelRef}>
      <h3>Traces & Tools</h3>
      <div className="trace-list">
        {entries.map(({ trace, depth }, idx) => (
          <div
            key={idx}
            className="trace-row"
            style={depth > 0
              ? {
                marginLeft: depth * 12,
                borderLeft: "2px solid #e2e8f0",
                paddingLeft: 8,
              }
              : undefined}
          >
            <strong>{trace.type ?? "trace"}</strong>
            {trace.message?.content && (
              <div className="trace-text">{trace.message.content}</div>
            )}
            {!trace.message?.content && (
              <pre className="trace-json">
                {JSON.stringify(trace, null, 2)}
              </pre>
            )}
          </div>
        ))}
        {traces.length === 0 && (
          <div className="trace-empty">No trace events yet.</div>
        )}
      </div>
    </div>
  );
}

function SessionModal(props: {
  open: boolean;
  sessions: SessionMeta[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}) {
  const { open, sessions, loading, error, onRefresh, onSelect, onClose } =
    props;
  if (!open) return null;
  return (
    <div className="sessions-overlay">
      <div className="sessions-dialog">
        <header>
          <h2>Sessions</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="sessions-body">
          <button type="button" onClick={onRefresh}>Refresh</button>
          {loading && <p>Loading sessions…</p>}
          {error && <p className="error">{error}</p>}
          <ul>
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                >
                  <strong>
                    {session.deckSlug ?? session.deck ?? "session"}
                  </strong>
                  <span>{formatTimestamp(session.createdAt)}</span>
                  <code>{session.id}</code>
                </button>
              </li>
            ))}
          </ul>
          {sessions.length === 0 && !loading && <p>No saved sessions yet.</p>}
        </div>
      </div>
    </div>
  );
}

function RecentSessionsEmptyState(props: {
  sessions: SessionMeta[];
  loading: boolean;
  error: string | null;
  onSelect: (sessionId: string) => void;
  onOpenAll: () => void;
}) {
  const { sessions, loading, error, onSelect, onOpenAll } = props;
  const preview = sessions.slice(0, 4);
  return (
    <div className="empty-state">
      <p>Start a new chat or load a previous session to review feedback.</p>
      {loading && <p>Loading recent sessions…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && preview.length === 0 && (
        <p>No saved sessions yet.</p>
      )}
      {!loading && !error && preview.length > 0 && (
        <div className="recent-sessions">
          {preview.map((session) => (
            <button
              key={session.id}
              type="button"
              className="recent-session-button"
              onClick={() => onSelect(session.id)}
            >
              <strong>{session.deckSlug ?? session.deck ?? "session"}</strong>
              <span>{formatTimestamp(session.createdAt)}</span>
              <code>{session.id}</code>
            </button>
          ))}
        </div>
      )}
      <div className="empty-state-actions">
        <button type="button" className="ghost-btn" onClick={onOpenAll}>
          View all sessions
        </button>
      </div>
    </div>
  );
}

function useHttpSchema() {
  const [schemaResponse, setSchemaResponse] = useState<SchemaResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/schema");
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as SchemaResponse;
      setSchemaResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schema");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { schemaResponse, loading, error, refresh };
}

function JsonInputField(props: {
  value: unknown;
  optional: boolean;
  placeholder?: string;
  onChange: (value: unknown) => void;
  onErrorChange?: (error: string | null) => void;
}) {
  const { value, optional, placeholder, onChange, onErrorChange } = props;
  const [text, setText] = useState(() => {
    if (value === undefined) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dirty) return;
    if (value === undefined) {
      setText("");
      return;
    }
    try {
      setText(JSON.stringify(value, null, 2));
    } catch {
      setText(String(value));
    }
  }, [value, dirty]);

  useEffect(() => {
    onErrorChange?.(error);
  }, [error, onErrorChange]);

  useEffect(() => {
    if (!dirty) return;
    const handle = window.setTimeout(() => {
      const trimmed = text.trim();
      if (trimmed === "") {
        if (optional) {
          setError(null);
          onChange(undefined);
        } else {
          setError("Required");
        }
        return;
      }
      try {
        const parsed = JSON.parse(text);
        setError(null);
        onChange(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid JSON");
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [dirty, text, optional, onChange]);

  return (
    <>
      <textarea
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
      />
      {error && <div className="error">{error}</div>}
    </>
  );
}

function InitForm(props: {
  schema: NormalizedSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  onJsonErrorChange: (pathKey: string, error: string | null) => void;
}) {
  const { schema, value, onChange, onJsonErrorChange } = props;
  const leaves = useMemo(() => flattenSchemaLeaves(schema), [schema]);

  return (
    <div className="init-grid">
      {leaves.map(({ path, schema: fieldSchema }) => {
        const pathKey = path.join(".");
        const label = pathKey || "input";
        const fieldValue = getPathValue(value, path);
        const badgeText = fieldSchema.optional ? "optional" : "required";
        const description = fieldSchema.description;

        const setFieldValue = (nextFieldValue: unknown) => {
          const nextRoot = setPathValue(value, path, nextFieldValue);
          onChange(nextRoot);
        };

        return (
          <div className="init-field" key={pathKey}>
            <label>
              <span>{label}</span>
              <span className="badge">{badgeText}</span>
            </label>
            {description && <div className="secondary-note">{description}</div>}
            {fieldSchema.kind === "string" && (
              <input
                value={typeof fieldValue === "string" ? fieldValue : ""}
                placeholder={fieldSchema.optional ? "" : "required"}
                onChange={(e) =>
                  setFieldValue(
                    e.target.value === "" && fieldSchema.optional
                      ? undefined
                      : e.target.value,
                  )}
              />
            )}
            {fieldSchema.kind === "number" && (
              <input
                type="number"
                value={typeof fieldValue === "number" ? String(fieldValue) : ""}
                placeholder={fieldSchema.optional ? "" : "required"}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "" && fieldSchema.optional) {
                    setFieldValue(undefined);
                    return;
                  }
                  const parsed = Number(raw);
                  setFieldValue(Number.isFinite(parsed) ? parsed : undefined);
                }}
              />
            )}
            {fieldSchema.kind === "boolean" && (
              <label style={{ fontWeight: 600, justifyContent: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={Boolean(fieldValue)}
                  onChange={(e) =>
                    setFieldValue(e.target.checked)}
                />
                <span>{Boolean(fieldValue) ? "true" : "false"}</span>
              </label>
            )}
            {fieldSchema.kind === "enum" && (
              <select
                value={fieldValue === undefined ? "" : String(fieldValue)}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "" && fieldSchema.optional) {
                    setFieldValue(undefined);
                    return;
                  }
                  setFieldValue(raw);
                }}
              >
                <option value="">
                  {fieldSchema.optional ? "— optional —" : "Select"}
                </option>
                {(fieldSchema.enumValues ?? []).map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
            )}
            {(fieldSchema.kind === "array" || fieldSchema.kind === "unknown" ||
              fieldSchema.kind === "object") &&
              (
                <JsonInputField
                  value={fieldValue}
                  optional={fieldSchema.optional}
                  placeholder="JSON"
                  onChange={(nextVal) => {
                    onJsonErrorChange(pathKey, null);
                    setFieldValue(nextVal);
                  }}
                  onErrorChange={(err) => onJsonErrorChange(pathKey, err)}
                />
              )}
          </div>
        );
      })}
    </div>
  );
}

function InitPanel(props: {
  schema: NormalizedSchema;
  value: unknown;
  lockedValue: unknown;
  editable: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missingRequired: string[];
  jsonErrorCount: number;
  schemaError?: string;
  onChange: (next: unknown) => void;
  onJsonErrorChange: (pathKey: string, err: string | null) => void;
}) {
  const {
    schema,
    value,
    lockedValue,
    editable,
    open,
    onOpenChange,
    missingRequired,
    jsonErrorCount,
    schemaError,
    onChange,
    onJsonErrorChange,
  } = props;

  const summaryLabel = editable
    ? "Init input (required before chat)"
    : "Init input (locked)";
  const summaryValue = editable ? value : lockedValue;

  return (
    <details
      className="init-panel"
      open={open}
      onToggle={(e) =>
        onOpenChange((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{summaryLabel}</summary>
      {schemaError && <div className="error">Schema error: {schemaError}</div>}
      <div className="hint">
        Fields are generated from the deck input schema. Start a new chat to
        change init.
      </div>
      {editable && (
        <>
          <InitForm
            schema={schema}
            value={value}
            onChange={onChange}
            onJsonErrorChange={onJsonErrorChange}
          />
          {(missingRequired.length > 0 || jsonErrorCount > 0) && (
            <div className="init-missing">
              {missingRequired.length > 0 && (
                <div>
                  Missing required: {missingRequired.slice(0, 6).join(", ")}
                  {missingRequired.length > 6 ? "…" : ""}
                </div>
              )}
              {jsonErrorCount > 0 && (
                <div>Fix invalid JSON fields to continue.</div>
              )}
            </div>
          )}
        </>
      )}
      {!editable && (
        <pre className="init-summary-json">
          {JSON.stringify(summaryValue ?? {}, null, 2)}
        </pre>
      )}
    </details>
  );
}

function App() {
  const simulator = useSimulator();
  const httpSchema = useHttpSchema();
  const { sessions, loading: sessionsLoading, error: sessionsError, refresh } =
    useSessions();
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingReset, setPendingReset] = useState(false);
  const [initValue, setInitValue] = useState<unknown>(undefined);
  const [initDirty, setInitDirty] = useState(false);
  const [initOpen, setInitOpen] = useState(false);
  const [jsonErrors, setJsonErrors] = useState<Record<string, string | null>>(
    {},
  );
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const appliedSessionIdRef = useRef<string | null>(null);
  const currentDeckSlug = useMemo(() => toDeckSlug(deckPath), []);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteStatus, setNoteStatus] = useState<
    "idle" | "dirty" | "saving" | "saved"
  >("idle");
  const pendingNoteRef = useRef<string | null>(null);
  const [scoreStatus, setScoreStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const pendingScoreRef = useRef<number | null>(null);

  useEffect(() => {
    if (simulator.connectionStatus === "connecting") {
      appliedSessionIdRef.current = null;
    }
  }, [simulator.connectionStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (sessionsOpen) refresh();
  }, [sessionsOpen, refresh]);

  const schema = simulator.schemaResponse?.schema ??
    httpSchema.schemaResponse?.schema;
  const schemaDefaults = simulator.schemaResponse?.defaults ??
    httpSchema.schemaResponse?.defaults;
  const schemaError = simulator.schemaResponse?.error ??
    httpSchema.schemaResponse?.error ??
    httpSchema.error ??
    undefined;

  const conversationStarted = Boolean(
    simulator.savedState && simulator.savedState.messages.length > 0,
  );
  const initEditable = Boolean(schema) &&
    (!conversationStarted || pendingReset);
  const lockedInitValue = useMemo(() => {
    const fromTraces = extractInitFromTraces(simulator.savedState?.traces);
    if (fromTraces !== undefined) return fromTraces;
    return schemaDefaults ?? deriveInitialFromSchema(schema);
  }, [simulator.savedState?.traces, schemaDefaults, schema]);

  useEffect(() => {
    if (!schema) return;
    if (initDirty) return;
    if (schemaDefaults !== undefined) {
      setInitValue(cloneValue(schemaDefaults));
      return;
    }
    setInitValue(deriveInitialFromSchema(schema));
  }, [schema, schemaDefaults, initDirty]);

  useEffect(() => {
    if (initEditable) {
      setInitOpen(true);
    }
  }, [initEditable]);

  const messages = useMemo(() => {
    if (!simulator.savedState) return [];
    const feedbackByRef = new Map(
      simulator.savedState.feedback?.map((f) => [f.messageRefId, f]) ?? [],
    );
    return simulator.savedState.messages.map((message, idx) => {
      const ref = simulator.savedState?.messageRefs?.[idx];
      return {
        id: ref?.id,
        message,
        feedback: ref ? feedbackByRef.get(ref.id) : undefined,
      };
    });
  }, [simulator.savedState]);

  const missingRequired = useMemo(() => {
    if (!schema || !initEditable) return [];
    return findMissingRequiredFields(schema, initValue);
  }, [schema, initEditable, initValue]);

  const jsonErrorCount = useMemo(() => {
    return Object.values(jsonErrors).filter((v) => typeof v === "string" && v)
      .length;
  }, [jsonErrors]);

  const canStartWithInit = Boolean(schema) &&
    initEditable &&
    missingRequired.length === 0 &&
    jsonErrorCount === 0;

  const resetInitValue = useCallback(() => {
    if (schemaDefaults !== undefined) {
      setInitValue(cloneValue(schemaDefaults));
    } else if (schema) {
      setInitValue(deriveInitialFromSchema(schema));
    } else {
      setInitValue(undefined);
    }
  }, [schema, schemaDefaults]);

  const startNewChat = useCallback(
    (opts?: { pushHistory?: boolean; replace?: boolean }) => {
      const shouldPush = opts?.pushHistory ?? true;
      if (shouldPush) {
        if (opts?.replace) {
          window.history.replaceState({}, "", "/");
        } else {
          window.history.pushState({}, "", "/");
        }
      }
      setPendingSessionId(null);
      appliedSessionIdRef.current = null;
      setPendingReset(true);
      simulator.resetLocal();
      setInitDirty(false);
      setJsonErrors({});
      resetInitValue();
      setInitOpen(Boolean(schema));
      pendingNoteRef.current = null;
      setNoteDraft("");
      setNoteStatus("idle");
      pendingScoreRef.current = null;
      setScoreStatus("idle");
    },
    [schema, simulator, resetInitValue],
  );

  const adoptSessionFromPath = useCallback((sessionId: string) => {
    appliedSessionIdRef.current = null;
    setPendingSessionId(sessionId);
    setPendingReset(false);
    setInitOpen(false);
    setInitDirty(true);
  }, []);

  const navigateToSession = useCallback(
    (sessionId: string, opts?: { replace?: boolean }) => {
      const url = `/sessions/${encodeURIComponent(sessionId)}`;
      if (opts?.replace) {
        window.history.replaceState({}, "", url);
      } else {
        window.history.pushState({}, "", url);
      }
      adoptSessionFromPath(sessionId);
    },
    [adoptSessionFromPath],
  );

  useEffect(() => {
    const initialSession = getSessionIdFromPath();
    if (initialSession) {
      navigateToSession(initialSession, { replace: true });
    } else {
      startNewChat({ pushHistory: false });
    }
  }, [navigateToSession, startNewChat]);

  useEffect(() => {
    const handler = () => {
      const sessionFromPath = getSessionIdFromPath();
      if (sessionFromPath) {
        adoptSessionFromPath(sessionFromPath);
      } else {
        startNewChat({ pushHistory: false });
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [adoptSessionFromPath, startNewChat]);

  useEffect(() => {
    if (!pendingSessionId) return;
    if (simulator.connectionStatus !== "connected") return;
    if (appliedSessionIdRef.current === pendingSessionId) return;
    simulator.loadSession(pendingSessionId);
    appliedSessionIdRef.current = pendingSessionId;
  }, [
    pendingSessionId,
    simulator.connectionStatus,
    simulator.loadSession,
    simulator.readySeq,
  ]);

  const serverNotesText = simulator.savedState?.notes?.text ?? "";
  const serverNotesUpdatedAt = simulator.savedState?.notes?.updatedAt;
  const serverScore = simulator.savedState?.conversationScore?.score ?? null;
  const serverScoreUpdatedAt = simulator.savedState?.conversationScore
    ?.updatedAt;

  useEffect(() => {
    if (pendingNoteRef.current !== null) {
      if (serverNotesText === pendingNoteRef.current) {
        pendingNoteRef.current = null;
        setNoteStatus(serverNotesText ? "saved" : "idle");
      }
      return;
    }
    setNoteDraft(serverNotesText);
    setNoteStatus(serverNotesText ? "saved" : "idle");
  }, [serverNotesText]);

  useEffect(() => {
    if (noteStatus !== "dirty") return;
    const handle = window.setTimeout(() => {
      setNoteStatus("saving");
      pendingNoteRef.current = noteDraft;
      simulator.saveNotes(noteDraft);
    }, 700);
    return () => window.clearTimeout(handle);
  }, [noteStatus, noteDraft, simulator]);

  useEffect(() => {
    if (pendingScoreRef.current !== null) {
      if (serverScore === pendingScoreRef.current) {
        pendingScoreRef.current = null;
        setScoreStatus("saved");
      }
      return;
    }
    if (serverScore === null) {
      setScoreStatus("idle");
    } else {
      setScoreStatus("saved");
    }
  }, [serverScore]);

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (schema && initEditable) {
      if (!canStartWithInit) return;
      simulator.run({
        input: initValue,
        message: trimmed.length ? trimmed : undefined,
        resetState: pendingReset,
        trace: true,
      });
      setMessage("");
      setPendingReset(false);
      setInitDirty(true);
      return;
    }

    if (!trimmed) return;
    simulator.run({ message: trimmed, resetState: pendingReset, trace: true });
    setMessage("");
    setPendingReset(false);
  }, [
    message,
    simulator,
    pendingReset,
    schema,
    initEditable,
    canStartWithInit,
    initValue,
  ]);

  const handleScore = useCallback(
    (refId: string, score: number) => {
      simulator.sendFeedback(refId, score);
    },
    [simulator],
  );

  const handleReason = useCallback(
    (refId: string, score: number, reason: string) => {
      simulator.sendFeedback(refId, score, reason);
    },
    [simulator],
  );

  const runMeta = simulator.savedState?.meta ?? {};
  const sessionId = typeof runMeta.sessionId === "string"
    ? runMeta.sessionId
    : undefined;
  const currentSessionScore = pendingScoreRef.current !== null
    ? pendingScoreRef.current
    : serverScore;

  const deckSessions = useMemo(() => {
    return sessions.filter((session) => {
      if (!session) return false;
      if (session.deckSlug) return session.deckSlug === currentDeckSlug;
      if (typeof session.deck === "string") {
        return toDeckSlug(session.deck) === currentDeckSlug;
      }
      return false;
    });
  }, [sessions, currentDeckSlug]);

  const recentSessionsEmpty = (
    <RecentSessionsEmptyState
      sessions={deckSessions}
      loading={sessionsLoading}
      error={sessionsError}
      onSelect={(id) => navigateToSession(id)}
      onOpenAll={() => setSessionsOpen(true)}
    />
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Gambit Simulator</h1>
          <div className="deck-path">{deckPath}</div>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => setSessionsOpen(true)}>
            Sessions
          </button>
          <button
            type="button"
            onClick={() => startNewChat()}
            className={pendingReset ? "primary" : ""}
          >
            New Chat
          </button>
          <div className={`status-indicator ${simulator.connectionStatus}`}>
            {simulator.connectionStatus}
          </div>
        </div>
      </header>
      <main className="app-main">
        <ConversationView
          messages={messages}
          header={schema
            ? (
              <InitPanel
                schema={schema}
                value={initValue}
                lockedValue={lockedInitValue}
                editable={initEditable}
                open={initOpen}
                onOpenChange={setInitOpen}
                missingRequired={missingRequired}
                jsonErrorCount={jsonErrorCount}
                schemaError={schemaError}
                onChange={(next) => {
                  setInitValue(next);
                  setInitDirty(true);
                }}
                onJsonErrorChange={(pathKey, err) =>
                  setJsonErrors((prev) => ({ ...prev, [pathKey]: err }))}
              />
            )
            : undefined}
          emptyState={recentSessionsEmpty}
          onScore={handleScore}
          onReasonChange={handleReason}
        />
        <TraceList traces={simulator.traceEvents} />
      </main>
      <footer className="composer">
        <div className="composer-inputs">
          <textarea
            className="message-input"
            placeholder={schema && initEditable
              ? "Optional first message (init will be sent too)"
              : "Send a user message to the assistant"}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="notes-inline">
            <header>
              <label htmlFor="session-notes">Session notes</label>
              <div className="rating-controls">
                <span className="rating-label">Overall score</span>
                {SCORE_VALUES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={classNames(
                      "rating-button",
                      currentSessionScore === value && "active",
                    )}
                    onClick={() => {
                      pendingScoreRef.current = value;
                      setScoreStatus("saving");
                      simulator.saveSessionScore(value);
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </header>
            <textarea
              id="session-notes"
              value={noteDraft}
              onChange={(e) => {
                setNoteDraft(e.target.value);
                setNoteStatus("dirty");
              }}
              placeholder="Add context or TODOs..."
            />
            <div className="notes-inline-status">
              <span
                className={classNames(
                  "state",
                  noteStatus === "saving" && "saving",
                  noteStatus === "dirty" && "unsaved",
                  noteStatus === "idle" && "idle",
                  noteStatus === "saved" && "saved",
                )}
              >
                {noteStatus === "saving"
                  ? "Saving…"
                  : noteStatus === "dirty"
                  ? "Unsaved changes…"
                  : noteStatus === "saved"
                  ? serverNotesUpdatedAt
                    ? `Saved ${formatTimestamp(serverNotesUpdatedAt)}`
                    : "Saved"
                  : "No notes yet."}
              </span>
            </div>
            <div className="rating-status">
              Overall score:{" "}
              {currentSessionScore !== null ? currentSessionScore : "—"}
              {" · "}
              {scoreStatus === "saving"
                ? "Saving…"
                : scoreStatus === "saved"
                ? serverScoreUpdatedAt
                  ? `Saved ${formatTimestamp(serverScoreUpdatedAt)}`
                  : "Saved"
                : "Not set"}
            </div>
          </div>
        </div>
        {pendingReset && (
          <div className="reset-note">Next message will start a new chat.</div>
        )}
        <div className="composer-actions">
          <button
            type="button"
            onClick={handleSend}
            disabled={schema && initEditable && !canStartWithInit}
          >
            {schema && initEditable ? "Start chat" : "Send"}
          </button>
          <button type="button" onClick={simulator.reconnect}>
            Reconnect
          </button>
        </div>
        {simulator.errors.map((err, idx) => (
          <div key={idx} className="error">
            {err}
          </div>
        ))}
        {sessionId && (
          <div className="session-meta">
            Session: <code>{sessionId}</code>
          </div>
        )}
      </footer>
      <SessionModal
        open={sessionsOpen}
        sessions={deckSessions}
        loading={sessionsLoading}
        error={sessionsError}
        onRefresh={refresh}
        onSelect={(id) => {
          navigateToSession(id);
          setSessionsOpen(false);
        }}
        onClose={() => setSessionsOpen(false)}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
