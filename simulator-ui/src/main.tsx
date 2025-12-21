import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { FeedbackList } from "./components/FeedbackList.tsx";
import { SessionDrawer } from "./components/SessionDrawer.tsx";
import { globalStyles } from "./styles.ts";
import { classNames, formatTimestamp } from "./utils.ts";

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

type SessionState = {
  messages?: ModelMessage[];
  messageRefs?: MessageRef[];
  notes?: SessionNotes;
};

type SessionContextWindow = {
  sessionId: string;
  targetIndex: number;
  start: number;
  end: number;
  messages: Array<{
    role: string;
    content?: string | null;
    id?: string;
  }>;
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

type TestBotRun = {
  id?: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  sessionId?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  maxTurns?: number;
  messages: Array<{
    role: string;
    content: string;
    messageRefId?: string;
    feedback?: FeedbackEntry;
  }>;
};

function countUserMessages(
  messages: Array<{ role: string; content: string }>,
) {
  return messages.filter((m) => m.role === "user").length;
}

type TestBotStreamEvent = {
  type: "testBotStream";
  runId?: string;
  role: "user" | "assistant";
  chunk: string;
  turn?: number;
};

type TestBotStreamEndEvent = {
  type: "testBotStreamEnd";
  runId?: string;
  role: "user" | "assistant";
  turn?: number;
};

type TestBotStatusEvent = {
  type: "testBotStatus";
  run?: TestBotRun;
};

type TestBotSocketMessage =
  | TestBotStreamEvent
  | TestBotStreamEndEvent
  | TestBotStatusEvent;

type TestBotDefaults = {
  model?: string;
  temperature?: number;
  maxTurns?: number;
  input?: unknown;
};

type AssistantChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ReplaceRangeEdit = {
  start: number;
  end: number;
  text: string;
};

type PatchProposal = {
  summary: string;
  edits: ReplaceRangeEdit[];
};

type EditorAssistantResponse = {
  messages?: Array<{ role?: string; content?: string | null }>;
  patch?: PatchProposal;
  error?: string;
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
  | { type: "result"; result: unknown; runId?: string; streamed?: boolean }
  | { type: "pong" }
  | { type: "error"; message: string; runId?: string };

const SCORE_VALUES = [-3, -2, -1, 0, 1, 2, 3];

const deckPath = (window as unknown as { __GAMBIT_DECK_PATH__?: string })
  .__GAMBIT_DECK_PATH__ ?? "Unknown deck";

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
  const [streamText, setStreamText] = useState("");
  const [isRunning, setIsRunning] = useState(false);
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
      setIsRunning(false);
      setStreamText("");
    };

    ws.onerror = () => {
      setConnectionStatus("error");
      setErrors((prev) => [...prev, "WebSocket connection error"]);
      setIsRunning(false);
      setStreamText("");
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
        } else if (msg.type === "stream") {
          if (typeof msg.chunk === "string" && msg.chunk.length > 0) {
            setStreamText((prev) => prev + msg.chunk);
          }
        } else if (msg.type === "result") {
          setIsRunning(false);
          setStreamText("");
        } else if (msg.type === "trace" && msg.event) {
          setTraceEvents((prev) => [...prev, msg.event].slice(-200));
        } else if (msg.type === "error") {
          setErrors((prev) => [...prev, msg.message ?? "Unknown error"]);
          if (msg.runId || msg.message !== "Run already in progress") {
            setIsRunning(false);
          }
          setStreamText("");
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
      setIsRunning(true);
      setStreamText("");
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
    setStreamText("");
  }, []);

  return {
    connectionStatus,
    savedState,
    traceEvents,
    errors,
    schemaResponse,
    readySeq,
    isRunning,
    streamText,
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

function pathDirname(p: string): string {
  const parts = p.split(/[/\\]+/);
  parts.pop();
  return parts.join("/") || ".";
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

function normalizeBasePath(basePath: string): string {
  if (basePath === "/") return "";
  return basePath.replace(/\/+$/, "");
}

function getSessionIdFromPath(
  pathname?: string,
  basePath = "/debug",
): string | null {
  const target = typeof pathname === "string"
    ? pathname
    : window.location.pathname;
  const bases = [basePath, "/simulate", ""];
  for (const base of bases) {
    const normalized = normalizeBasePath(base);
    const prefix = `${normalized}/sessions/`.replace(/^\/\//, "/");
    if (normalized === "" && !target.startsWith("/sessions/")) continue;
    if (normalized !== "" && !target.startsWith(prefix)) continue;
    const remainder = normalized === ""
      ? target.slice("/sessions/".length)
      : target.slice(prefix.length);
    if (remainder.length > 0) {
      return decodeURIComponent(remainder);
    }
  }
  return null;
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

function normalizePatchProposal(
  raw: unknown,
): { patch?: PatchProposal; error?: string } {
  if (!raw || typeof raw !== "object") {
    return { error: "Patch payload missing" };
  }
  const summary = (raw as { summary?: unknown }).summary;
  const editsRaw = (raw as { edits?: unknown }).edits;
  if (typeof summary !== "string") {
    return { error: "Patch summary is missing" };
  }
  if (!Array.isArray(editsRaw)) {
    return { error: "Patch edits are missing" };
  }
  const edits: ReplaceRangeEdit[] = [];
  for (let i = 0; i < editsRaw.length; i++) {
    const edit = editsRaw[i] as {
      start?: unknown;
      end?: unknown;
      text?: unknown;
    };
    const start = typeof edit.start === "number"
      ? edit.start
      : Number(edit.start);
    const end = typeof edit.end === "number" ? edit.end : Number(edit.end);
    const text = edit.text;
    if (
      !Number.isFinite(start) || !Number.isFinite(end) ||
      typeof text !== "string"
    ) {
      return { error: `Edit ${i + 1} is invalid` };
    }
    if (start < 0 || end < 0 || end < start) {
      return { error: `Edit ${i + 1} has invalid bounds` };
    }
    if (i > 0 && start < edits[i - 1].end) {
      return {
        error: "Edits must be sorted and non-overlapping",
      };
    }
    edits.push({ start, end, text });
  }
  return { patch: { summary, edits } };
}

function applyPatchProposal(
  content: string,
  patch: PatchProposal,
): { ok: true; next: string } | { ok: false; error: string } {
  let cursor = 0;
  let next = "";
  for (let i = 0; i < patch.edits.length; i++) {
    const edit = patch.edits[i];
    if (edit.start < cursor) {
      return { ok: false, error: "Edits overlap; cannot apply patch" };
    }
    if (edit.start > content.length || edit.end > content.length) {
      return { ok: false, error: `Edit ${i + 1} is out of bounds` };
    }
    next += content.slice(cursor, edit.start);
    next += edit.text;
    cursor = edit.end;
  }
  next += content.slice(cursor);
  return { ok: true, next };
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
        {entries.map(({ trace, depth }, idx) => {
          const isUser = trace.type === "message.user";
          return (
            <div
              key={idx}
              className={classNames("trace-row", isUser && "trace-row-user")}
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
          );
        })}
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
                <button type="button" onClick={() => onSelect(session.id)}>
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
  const onChangeRef = useRef(onChange);
  const onErrorChangeRef = useRef(onErrorChange);
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
    onChangeRef.current = onChange;
    onErrorChangeRef.current = onErrorChange;
  }, [onChange, onErrorChange]);

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
    onErrorChangeRef.current?.(error);
  }, [error]);

  useEffect(() => {
    if (!dirty) return;
    const handle = window.setTimeout(() => {
      const trimmed = text.trim();
      if (trimmed === "") {
        if (optional) {
          setError(null);
          onChangeRef.current(undefined);
        } else {
          setError("Required");
        }
        return;
      }
      try {
        const parsed = JSON.parse(text);
        setError(null);
        onChangeRef.current(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid JSON");
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [dirty, text, optional]);

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
  mode: "form" | "json";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: "form" | "json") => void;
  missingRequired: string[];
  jsonErrorCount: number;
  rootJsonText: string;
  rootJsonError: string | null;
  onRootJsonChange: (
    text: string,
    error: string | null,
    parsed?: unknown,
  ) => void;
  schemaError?: string;
  onChange: (next: unknown) => void;
  onJsonErrorChange: (pathKey: string, err: string | null) => void;
}) {
  const {
    schema,
    value,
    lockedValue,
    editable,
    mode,
    open,
    onOpenChange,
    onModeChange,
    missingRequired,
    jsonErrorCount,
    rootJsonText,
    rootJsonError,
    onRootJsonChange,
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
        Fields are generated from the deck input schema. You can use the form or
        a raw JSON payload. Start a new chat to change init.
      </div>
      {editable && (
        <>
          <div className="panel-tabs" style={{ marginTop: 6 }}>
            <button
              type="button"
              className={classNames("panel-tab", mode === "form" && "active")}
              onClick={() => onModeChange("form")}
            >
              Form
            </button>
            <button
              type="button"
              className={classNames("panel-tab", mode === "json" && "active")}
              onClick={() => onModeChange("json")}
            >
              JSON
            </button>
          </div>
          {mode === "form"
            ? (
              <InitForm
                schema={schema}
                value={value}
                onChange={onChange}
                onJsonErrorChange={onJsonErrorChange}
              />
            )
            : (
              <div className="init-field">
                <label>
                  <span>Init JSON</span>
                  <span className="badge">root</span>
                </label>
                <textarea
                  className="json-input"
                  value={rootJsonText}
                  placeholder="Paste full init JSON payload"
                  onChange={(e) => {
                    const text = e.target.value;
                    let error: string | null = null;
                    let parsed: unknown = undefined;
                    if (text.trim() === "") {
                      parsed = undefined;
                    } else {
                      try {
                        parsed = JSON.parse(text);
                      } catch (err) {
                        error = err instanceof Error
                          ? err.message
                          : "Invalid JSON";
                      }
                    }
                    onRootJsonChange(text, error, parsed);
                  }}
                  style={{ minHeight: 140 }}
                />
                {rootJsonError && <div className="error">{rootJsonError}</div>}
                {!rootJsonError && (
                  <div className="secondary-note">
                    Leave blank to unset init. Parsed JSON replaces the form.
                  </div>
                )}
              </div>
            )}
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

function SimulatorApp({ basePath }: { basePath: string }) {
  const simulator = useSimulator();
  const httpSchema = useHttpSchema();
  const { sessions, loading: sessionsLoading, error: sessionsError, refresh } =
    useSessions();
  const normalizedBase = normalizeBasePath(basePath || "/debug");
  const rootPath = normalizedBase === "" ? "/" : normalizedBase;
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingReset, setPendingReset] = useState(false);
  const [initValue, setInitValue] = useState<unknown>(undefined);
  const [initDirty, setInitDirty] = useState(false);
  const [initMode, setInitMode] = useState<"form" | "json">("form");
  const [initJsonText, setInitJsonText] = useState("");
  const [initJsonError, setInitJsonError] = useState<string | null>(null);
  const [initOpen, setInitOpen] = useState(false);
  const [jsonErrors, setJsonErrors] = useState<Record<string, string | null>>(
    {},
  );
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const appliedSessionIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
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
    if (initMode !== "json") return;
    if (initDirty) return;
    try {
      setInitJsonText(
        initValue === undefined ? "" : JSON.stringify(initValue, null, 2),
      );
    } catch {
      setInitJsonText(initValue ? String(initValue) : "");
    }
  }, [initMode, initValue, initDirty]);

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
    setInitJsonError(null);
    setJsonErrors((prev) => ({ ...prev, __root__: null }));
    setInitJsonText("");
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
        const target = rootPath || "/";
        if (opts?.replace) {
          window.history.replaceState({}, "", target);
        } else {
          window.history.pushState({}, "", target);
        }
      }
      setPendingSessionId(null);
      appliedSessionIdRef.current = null;
      setPendingReset(true);
      simulator.resetLocal();
      setInitDirty(false);
      setInitJsonError(null);
      setInitJsonText("");
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
      const prefix = rootPath === "/" ? "" : rootPath;
      const url = `${prefix}/sessions/${encodeURIComponent(sessionId)}`.replace(
        /^\/\//,
        "/",
      );
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
    if (initializedRef.current) return;
    initializedRef.current = true;
    const initialSession = getSessionIdFromPath(undefined, rootPath) ??
      getSessionIdFromPath();
    if (initialSession) {
      navigateToSession(initialSession, { replace: true });
      return;
    }
    startNewChat({ pushHistory: false });
  }, [navigateToSession, startNewChat, rootPath]);

  useEffect(() => {
    const handler = () => {
      const sessionFromPath = getSessionIdFromPath(undefined, rootPath) ??
        getSessionIdFromPath();
      if (sessionFromPath) {
        adoptSessionFromPath(sessionFromPath);
      } else {
        startNewChat({ pushHistory: false });
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [adoptSessionFromPath, startNewChat, rootPath]);

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

    if (!trimmed) {
      simulator.run({ resetState: pendingReset, trace: true });
      setMessage("");
      setPendingReset(false);
      return;
    }
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
          <h1>Gambit Debug</h1>
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
                mode={initMode}
                open={initOpen}
                onOpenChange={setInitOpen}
                onModeChange={(mode) => {
                  setInitMode(mode);
                  if (mode === "form") {
                    setInitJsonError(null);
                    setJsonErrors((prev) => ({ ...prev, __root__: null }));
                  } else {
                    try {
                      setInitJsonText(
                        initValue === undefined
                          ? ""
                          : JSON.stringify(initValue, null, 2),
                      );
                    } catch {
                      setInitJsonText(initValue ? String(initValue) : "");
                    }
                  }
                }}
                missingRequired={missingRequired}
                jsonErrorCount={jsonErrorCount}
                rootJsonText={initJsonText}
                rootJsonError={initJsonError}
                onRootJsonChange={(text, error, parsed) => {
                  setInitMode("json");
                  setInitJsonText(text);
                  setInitJsonError(error);
                  setInitDirty(true);
                  if (!error) {
                    setInitValue(parsed);
                    setJsonErrors((prev) => ({ ...prev, __root__: null }));
                  } else {
                    setJsonErrors((prev) => ({ ...prev, __root__: error }));
                  }
                }}
                schemaError={schemaError}
                onChange={(next) => {
                  setInitValue(next);
                  setInitDirty(true);
                }}
                onJsonErrorChange={(pathKey, err) =>
                  setJsonErrors((prev) =>
                    prev[pathKey] === err ? prev : { ...prev, [pathKey]: err }
                  )}
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
              : "Optional message (assistant can start)"}
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

type EditorFile = {
  path: string;
  relative: string;
  kind: "file" | "dir";
};

type FileTreeNode = {
  name: string;
  relative: string;
  kind: "file" | "dir";
  path?: string;
  children: FileTreeNode[];
};

function normalizeRelativePath(relative: string) {
  return relative.replace(/\\/g, "/");
}

function sortFileNodes(nodes: FileTreeNode[]) {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  nodes.forEach((node) => {
    if (node.children.length) sortFileNodes(node.children);
  });
  return nodes;
}

function buildFileTree(entries: EditorFile[]) {
  const root: FileTreeNode = {
    name: "",
    relative: "",
    kind: "dir",
    children: [],
  };
  const nodeByRelative = new Map<string, FileTreeNode>();
  nodeByRelative.set("", root);
  const entryByRelative = new Map<string, EditorFile>();
  for (const entry of entries) {
    const normalized = normalizeRelativePath(entry.relative);
    if (!normalized) continue;
    entryByRelative.set(normalized, { ...entry, relative: normalized });
  }
  const rels = Array.from(entryByRelative.keys()).sort((a, b) =>
    a.localeCompare(b)
  );
  for (const rel of rels) {
    const entry = entryByRelative.get(rel);
    if (!entry) continue;
    const parts = rel.split("/");
    let currentRel = "";
    let parent = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentRel = currentRel ? `${currentRel}/${part}` : part;
      let node = nodeByRelative.get(currentRel);
      if (!node) {
        const existing = entryByRelative.get(currentRel);
        const kind = existing?.kind ??
          (i === parts.length - 1 ? entry.kind : "dir");
        node = {
          name: part,
          relative: currentRel,
          kind,
          path: existing?.path,
          children: [],
        };
        nodeByRelative.set(currentRel, node);
        parent.children.push(node);
      }
      parent = node;
    }
    const target = nodeByRelative.get(rel);
    if (target) {
      target.path = entry.path;
      target.kind = entry.kind;
    }
  }
  return sortFileNodes(root.children);
}

function filterFileTree(nodes: FileTreeNode[], query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return nodes;
  const matches = (node: FileTreeNode) =>
    node.name.toLowerCase().includes(trimmed) ||
    node.relative.toLowerCase().includes(trimmed);
  const filterNode = (node: FileTreeNode): FileTreeNode | null => {
    const nextChildren = node.children
      .map(filterNode)
      .filter((child): child is FileTreeNode => Boolean(child));
    if (matches(node) || nextChildren.length > 0) {
      return { ...node, children: nextChildren };
    }
    return null;
  };
  return nodes
    .map(filterNode)
    .filter((node): node is FileTreeNode => Boolean(node));
}

function EditorApp(props: { onNavigateToSimulator: () => void }) {
  const { onNavigateToSimulator } = props;
  const allowedExtensions = useMemo(
    () => [".md", ".ts", ".tsx"],
    [],
  );
  const [config, setConfig] = useState<
    { activeDeckPath?: string; rootPath?: string }
  >({});
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [files, setFiles] = useState<EditorFile[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const [rootInput, setRootInput] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileStatus, setFileStatus] = useState<
    "idle" | "dirty" | "saving" | "saved" | "error"
  >("idle");
  const [notesContent, setNotesContent] = useState<string>("");
  const [notesStatus, setNotesStatus] = useState<
    "idle" | "dirty" | "saving" | "saved" | "error"
  >("idle");
  const [assistantMessages, setAssistantMessages] = useState<
    AssistantChatMessage[]
  >([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantPendingPatch, setAssistantPendingPatch] = useState<
    PatchProposal | null
  >(null);
  const [assistantRunning, setAssistantRunning] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantRejectReason, setAssistantRejectReason] = useState("");
  const [assistantApplyError, setAssistantApplyError] = useState<
    string | null
  >(null);
  const [leftTab, setLeftTab] = useState<"files" | "iteration">("files");
  const [rightTab, setRightTab] = useState<"assistant" | "quick-chat">(
    "quick-chat",
  );
  const quickSimulator = useSimulator();
  const quickSchema = useHttpSchema();
  const [quickMessage, setQuickMessage] = useState("");
  const [quickInitValue, setQuickInitValue] = useState<unknown>(undefined);
  const [quickInitDirty, setQuickInitDirty] = useState(false);
  const [quickInitMode, setQuickInitMode] = useState<"form" | "json">("form");
  const [quickInitJsonText, setQuickInitJsonText] = useState("");
  const [quickInitJsonError, setQuickInitJsonError] = useState<string | null>(
    null,
  );
  const [quickJsonErrors, setQuickJsonErrors] = useState<
    Record<string, string | null>
  >({});
  const [quickPendingReset, setQuickPendingReset] = useState(false);
  const [quickExpanded, setQuickExpanded] = useState<Record<string, boolean>>(
    {},
  );
  const quickThreadRef = useRef<HTMLDivElement | null>(null);
  const [feedback, setFeedback] = useState<
    Array<{
      sessionId: string;
      messageRefId: string;
      score?: number;
      reason?: string;
      createdAt?: string;
      archivedAt?: string;
      messageContent?: unknown;
      sessionCreatedAt?: string;
    }>
  >([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerSession, setDrawerSession] = useState<SessionState | null>(null);
  const [drawerContext, setDrawerContext] = useState<
    SessionContextWindow | null
  >(null);
  const [drawerShowFull, setDrawerShowFull] = useState(false);
  const [drawerNotesStatus, setDrawerNotesStatus] = useState<
    "idle" | "saving" | "error"
  >("idle");
  const drawerTargetRef = useRef<
    { sessionId: string; messageRefId: string } | null
  >(null);
  const assistantThreadRef = useRef<HTMLDivElement | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const saveNotesTimeoutRef = useRef<number | null>(null);
  const initialFileRef = useRef<string | null>(null);
  const autoLoadedActiveRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fileParam = params.get("file");
    if (fileParam) {
      try {
        initialFileRef.current = decodeURIComponent(fileParam);
      } catch {
        initialFileRef.current = fileParam;
      }
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      setConfig(data ?? {});
      const nextRoot = (data?.rootPath as string) ||
        (data?.activeDeckPath
          ? pathDirname(data.activeDeckPath as string)
          : "");
      setRootInput(nextRoot);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const isAllowedFile = useCallback(
    (p: string) => {
      const lower = p.toLowerCase();
      return allowedExtensions.some((ext) => lower.endsWith(ext));
    },
    [allowedExtensions],
  );

  const updateConfig = useCallback(
    async (next: { activeDeckPath?: string; rootPath?: string }) => {
      try {
        const res = await fetch("/api/config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        });
        const data = await res.json();
        setConfig(data ?? next);
        if (data?.rootPath) setRootInput(data.rootPath);
      } catch (err) {
        console.error(err);
      }
    },
    [],
  );

  const loadFiles = useCallback(
    async (root: string) => {
      setFilesLoading(true);
      setFilesError(null);
      try {
        const res = await fetch(
          `/api/files?root=${encodeURIComponent(root || "")}`,
        );
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json() as { files?: EditorFile[] };
        setFiles(data.files ?? []);
      } catch (err) {
        setFilesError(
          err instanceof Error ? err.message : "Failed to list files",
        );
        setFiles([]);
      } finally {
        setFilesLoading(false);
      }
    },
    [],
  );

  const loadFile = useCallback(async (target: string) => {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as { content?: string };
      setSelectedFile(target);
      setFileContent(data.content ?? "");
      setFileStatus("idle");
      const url = new URL(window.location.href);
      url.searchParams.set("file", encodeURIComponent(target));
      window.history.replaceState({}, "", url.toString());
    } catch (err) {
      setSelectedFile(target);
      setFileContent("");
      setFileStatus("error");
      console.error(err);
    }
  }, []);

  const fileByPath = useMemo(() => {
    const map = new Map<string, EditorFile>();
    files.forEach((entry) => map.set(entry.path, entry));
    return map;
  }, [files]);

  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const filteredFileTree = useMemo(
    () => filterFileTree(fileTree, fileQuery),
    [fileTree, fileQuery],
  );

  const refreshFiles = useCallback(() => {
    loadFiles(rootInput || ".");
  }, [loadFiles, rootInput]);

  const runFilesAction = useCallback(
    async (endpoint: string, body: Record<string, unknown>) => {
      setFilesBusy(true);
      setFilesError(null);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data?.error === "string" ? data.error : res.statusText,
          );
        }
        return data;
      } catch (err) {
        setFilesError(
          err instanceof Error ? err.message : "File operation failed",
        );
        return null;
      } finally {
        setFilesBusy(false);
      }
    },
    [],
  );

  const handleCreateEntry = useCallback(
    async (kind: "file" | "dir") => {
      const label = kind === "file" ? "file" : "folder";
      const relative = window.prompt(`New ${label} path (relative to root):`);
      if (!relative) return;
      const data = await runFilesAction("/api/files/create", {
        root: rootInput || ".",
        relative,
        kind,
        content: "",
      });
      await refreshFiles();
      if (kind === "file" && data?.path && isAllowedFile(String(data.path))) {
        await loadFile(String(data.path));
      }
    },
    [runFilesAction, refreshFiles, rootInput, isAllowedFile, loadFile],
  );

  const handleRenameEntry = useCallback(
    async (relative: string) => {
      const next = window.prompt("Rename to (relative to root):", relative);
      if (!next || next === relative) return;
      const data = await runFilesAction("/api/files/rename", {
        root: rootInput || ".",
        from: relative,
        to: next,
      });
      await refreshFiles();
      if (data?.path && selectedFile) {
        const prevEntry = fileByPath.get(selectedFile);
        if (
          prevEntry && normalizeRelativePath(prevEntry.relative) === relative
        ) {
          setSelectedFile(String(data.path));
          loadFile(String(data.path));
        }
      }
    },
    [
      runFilesAction,
      refreshFiles,
      rootInput,
      selectedFile,
      fileByPath,
      loadFile,
    ],
  );

  const handleDeleteEntry = useCallback(
    async (relative: string, kind: "file" | "dir") => {
      const message = kind === "dir"
        ? `Delete folder "${relative}" and all of its contents?`
        : `Delete file "${relative}"?`;
      if (!window.confirm(message)) return;
      await runFilesAction("/api/files/delete", {
        root: rootInput || ".",
        relative,
      });
      if (selectedFile) {
        const entry = fileByPath.get(selectedFile);
        if (entry && normalizeRelativePath(entry.relative) === relative) {
          setSelectedFile(null);
          setFileContent("");
          setFileStatus("idle");
        }
      }
      await refreshFiles();
    },
    [runFilesAction, refreshFiles, rootInput, selectedFile, fileByPath],
  );

  useEffect(() => {
    const root = config.rootPath ||
      (config.activeDeckPath ? pathDirname(config.activeDeckPath) : "") || "";
    if (!loadingConfig) {
      setRootInput(root);
      loadFiles(root || ".");
    }
  }, [config.rootPath, config.activeDeckPath, loadFiles, loadingConfig]);
  useEffect(() => {
    if (loadingConfig) return;
    if (!initialFileRef.current) return;
    const target = initialFileRef.current;
    initialFileRef.current = null;
    loadFile(target);
  }, [loadingConfig, loadFile]);
  useEffect(() => {
    if (loadingConfig) return;
    if (autoLoadedActiveRef.current) return;
    if (initialFileRef.current) return;
    if (!config.activeDeckPath) return;
    autoLoadedActiveRef.current = true;
    loadFile(config.activeDeckPath);
  }, [config.activeDeckPath, loadingConfig, loadFile]);

  useEffect(() => {
    if (!selectedFile) return;
    const entry = fileByPath.get(selectedFile);
    if (!entry) return;
    const parts = normalizeRelativePath(entry.relative).split("/");
    setExpandedDirs((prev) => {
      const next = { ...prev };
      let rel = "";
      for (let i = 0; i < parts.length - 1; i++) {
        rel = rel ? `${rel}/${parts[i]}` : parts[i];
        next[rel] = true;
      }
      return next;
    });
  }, [selectedFile, fileByPath]);

  useEffect(() => {
    setAssistantMessages([]);
    setAssistantPendingPatch(null);
    setAssistantInput("");
    setAssistantError(null);
    setAssistantRejectReason("");
    setAssistantApplyError(null);
    setAssistantRunning(false);
  }, [selectedFile]);

  const quickSchemaShape = quickSimulator.schemaResponse?.schema ??
    quickSchema.schemaResponse?.schema;
  const quickSchemaDefaults = quickSimulator.schemaResponse?.defaults ??
    quickSchema.schemaResponse?.defaults;
  const quickSchemaError = quickSimulator.schemaResponse?.error ??
    quickSchema.schemaResponse?.error ??
    quickSchema.error ??
    undefined;
  const quickHasState = Boolean(quickSimulator.savedState) &&
    !quickPendingReset;
  const quickSessionId = typeof quickSimulator.savedState?.meta?.sessionId ===
      "string"
    ? quickSimulator.savedState.meta.sessionId
    : undefined;
  const quickMessages = useMemo(() => {
    if (!quickSimulator.savedState) return [];
    const feedbackByRef = new Map(
      quickSimulator.savedState.feedback?.map((f) => [f.messageRefId, f]) ?? [],
    );
    return quickSimulator.savedState.messages.map((message, idx) => {
      const ref = quickSimulator.savedState?.messageRefs?.[idx];
      return {
        id: ref?.id,
        message,
        feedback: ref ? feedbackByRef.get(ref.id) : undefined,
      };
    });
  }, [quickSimulator.savedState]);

  useEffect(() => {
    setQuickExpanded({});
  }, [quickSessionId]);

  useEffect(() => {
    if (!quickSchemaShape) return;
    if (quickInitDirty) return;
    if (quickSchemaDefaults !== undefined) {
      setQuickInitValue(cloneValue(quickSchemaDefaults));
      return;
    }
    setQuickInitValue(deriveInitialFromSchema(quickSchemaShape));
  }, [quickSchemaShape, quickSchemaDefaults, quickInitDirty]);

  useEffect(() => {
    if (quickInitMode !== "json") return;
    if (quickInitDirty) return;
    try {
      setQuickInitJsonText(
        quickInitValue === undefined
          ? ""
          : JSON.stringify(quickInitValue, null, 2),
      );
    } catch {
      setQuickInitJsonText(quickInitValue ? String(quickInitValue) : "");
    }
  }, [quickInitMode, quickInitValue, quickInitDirty]);

  const quickMissingRequired = useMemo(() => {
    if (!quickSchemaShape) return [];
    return findMissingRequiredFields(quickSchemaShape, quickInitValue);
  }, [quickSchemaShape, quickInitValue]);

  const quickJsonErrorCount = useMemo(() => {
    return Object.values(quickJsonErrors).filter((v) =>
      typeof v === "string" && v
    )
      .length;
  }, [quickJsonErrors]);

  const quickIncludeInit = Boolean(quickSchemaShape) &&
    (!quickHasState || quickInitDirty);
  const quickCanStartWithInit = !quickIncludeInit ||
    (quickMissingRequired.length === 0 && quickJsonErrorCount === 0);
  const quickTrimmedMessage = quickMessage.trim();
  const quickCanSend = quickCanStartWithInit &&
    (quickIncludeInit || quickTrimmedMessage.length > 0 || !quickHasState);
  const quickCanSendNow = quickCanSend && !quickSimulator.isRunning;

  const handleQuickSend = useCallback(() => {
    if (!quickCanSendNow) return;
    const trimmed = quickTrimmedMessage;
    const payload: {
      input?: unknown;
      message?: string;
      resetState?: boolean;
      trace?: boolean;
    } = { resetState: quickPendingReset, trace: true };
    if (quickIncludeInit) {
      payload.input = quickInitValue === undefined ? {} : quickInitValue;
    }
    if (trimmed) {
      payload.message = trimmed;
    }
    quickSimulator.run(payload);
    setQuickMessage("");
    setQuickPendingReset(false);
    if (quickIncludeInit) setQuickInitDirty(true);
  }, [
    quickCanSendNow,
    quickIncludeInit,
    quickTrimmedMessage,
    quickPendingReset,
    quickInitValue,
    quickHasState,
    quickSimulator,
  ]);

  const handleQuickScore = useCallback(
    (refId: string, score: number) => {
      quickSimulator.sendFeedback(refId, score);
    },
    [quickSimulator],
  );

  const handleQuickReason = useCallback(
    (refId: string, score: number, reason: string) => {
      quickSimulator.sendFeedback(refId, score, reason);
    },
    [quickSimulator],
  );

  useEffect(() => {
    const el = quickThreadRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [quickMessages.length, quickSimulator.streamText]);

  const saveFile = useCallback(async (target: string, content: string) => {
    setFileStatus("saving");
    try {
      await fetch("/api/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target, content }),
      });
      setFileStatus("saved");
    } catch (err) {
      setFileStatus("error");
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (fileStatus !== "dirty" || !selectedFile) return;
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(() => {
      saveFile(selectedFile, fileContent);
    }, 600);
    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, [fileStatus, selectedFile, fileContent, saveFile]);

  useEffect(() => {
    if (notesStatus !== "dirty" || !config.activeDeckPath) return;
    if (saveNotesTimeoutRef.current) {
      window.clearTimeout(saveNotesTimeoutRef.current);
    }
    saveNotesTimeoutRef.current = window.setTimeout(async () => {
      setNotesStatus("saving");
      try {
        await fetch("/api/deck-notes", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deckPath: config.activeDeckPath,
            content: notesContent,
          }),
        });
        setNotesStatus("saved");
      } catch (err) {
        setNotesStatus("error");
        console.error(err);
      }
    }, 600);
    return () => {
      if (saveNotesTimeoutRef.current) {
        window.clearTimeout(saveNotesTimeoutRef.current);
      }
    };
  }, [notesStatus, notesContent, config.activeDeckPath]);

  const loadNotes = useCallback(async (deckPath?: string) => {
    if (!deckPath) {
      setNotesContent("");
      setNotesStatus("idle");
      return;
    }
    try {
      const res = await fetch(
        `/api/deck-notes?deckPath=${encodeURIComponent(deckPath)}`,
      );
      const data = await res.json() as { content?: string };
      setNotesContent(data.content ?? "");
      setNotesStatus(data.content ? "saved" : "idle");
    } catch (err) {
      console.error(err);
      setNotesContent("");
      setNotesStatus("error");
    }
  }, []);

  useEffect(() => {
    loadNotes(config.activeDeckPath);
  }, [config.activeDeckPath, loadNotes]);

  const loadFeedback = useCallback(async (deckPath?: string) => {
    if (!deckPath) {
      setFeedback([]);
      setFeedbackError(null);
      return;
    }
    setFeedbackLoading(true);
    setFeedbackError(null);
    try {
      const res = await fetch(
        `/api/feedback?deckPath=${encodeURIComponent(deckPath)}`,
      );
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as { items?: typeof feedback };
      setFeedback(data.items ?? []);
    } catch (err) {
      setFeedbackError(
        err instanceof Error ? err.message : "Failed to load feedback",
      );
      setFeedback([]);
    } finally {
      setFeedbackLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeedback(config.activeDeckPath);
  }, [config.activeDeckPath, loadFeedback]);

  const archiveFeedback = useCallback(
    async (sessionId: string, messageRefId: string, archived: boolean) => {
      setArchiving(`${sessionId}:${messageRefId}`);
      try {
        const res = await fetch("/api/feedback/archive", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, messageRefId, archived }),
        });
        if (!res.ok) throw new Error(res.statusText);
        setFeedback((prev) =>
          prev.map((f) =>
            f.sessionId === sessionId && f.messageRefId === messageRefId
              ? {
                ...f,
                archivedAt: archived ? new Date().toISOString() : undefined,
              }
              : f
          )
        );
      } catch (err) {
        setFeedbackError(
          err instanceof Error ? err.message : "Failed to update feedback",
        );
      } finally {
        setArchiving(null);
      }
    },
    [],
  );

  const buildContextWindow = (
    sessionId: string,
    messageRefId: string,
    state: SessionState,
    showFull: boolean,
  ): SessionContextWindow | null => {
    if (!state.messages || !state.messageRefs) return null;
    const idx = state.messageRefs.findIndex((ref) => ref?.id === messageRefId);
    if (idx === -1) return null;
    const windowSize = 5;
    const start = showFull ? 0 : Math.max(0, idx - windowSize);
    const end = showFull
      ? state.messages.length
      : Math.min(state.messages.length, idx + windowSize + 1);
    const slice = state.messages.slice(start, end).map((m, i) => ({
      role: m.role,
      content: m.content ?? "",
      id: state.messageRefs?.[start + i]?.id,
    }));
    return {
      sessionId,
      targetIndex: idx,
      start,
      end,
      messages: slice,
    };
  };

  const openSessionDrawer = useCallback(
    async (sessionId: string, messageRefId: string) => {
      drawerTargetRef.current = { sessionId, messageRefId };
      setDrawerOpen(true);
      setDrawerLoading(true);
      setDrawerError(null);
      setDrawerSession(null);
      setDrawerContext(null);
      try {
        const res = await fetch(
          `/api/session?sessionId=${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json() as SessionState;
        setDrawerSession(data);
        const context = buildContextWindow(
          sessionId,
          messageRefId,
          data,
          drawerShowFull,
        );
        setDrawerContext(context);
      } catch (err) {
        setDrawerError(
          err instanceof Error ? err.message : "Failed to load session",
        );
      } finally {
        setDrawerLoading(false);
      }
    },
    [drawerShowFull],
  );

  const saveDrawerNotes = useCallback(
    async (sessionId: string, text: string) => {
      setDrawerNotesStatus("saving");
      try {
        const res = await fetch("/api/session/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, text }),
        });
        if (!res.ok) throw new Error(res.statusText);
        setDrawerNotesStatus("idle");
      } catch (err) {
        setDrawerNotesStatus("error");
        console.error(err);
      }
    },
    [],
  );

  const handleToggleDrawerShowFull = useCallback(() => {
    const next = !drawerShowFull;
    setDrawerShowFull(next);
    const target = drawerTargetRef.current;
    if (target && drawerSession) {
      setDrawerContext(
        buildContextWindow(
          target.sessionId,
          target.messageRefId,
          drawerSession,
          next,
        ),
      );
    }
  }, [drawerShowFull, drawerSession]);

  const runAssistant = useCallback(
    async (transcript: AssistantChatMessage[]) => {
      if (!selectedFile) {
        setAssistantError("Select a file to start.");
        return;
      }
      setAssistantRunning(true);
      setAssistantError(null);
      setAssistantPendingPatch(null);
      try {
        const res = await fetch("/api/editor-assistant/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filePath: selectedFile,
            content: fileContent,
            messages: transcript,
          }),
        });
        const data = await res.json() as EditorAssistantResponse;
        if (!res.ok) {
          throw new Error(
            data?.error ?? `${res.status} ${res.statusText}`,
          );
        }
        const replies = Array.isArray(data.messages)
          ? data.messages
            .filter((m) =>
              m?.role === "assistant" && typeof m.content === "string" &&
              m.content.trim().length > 0
            )
            .map((m) => ({
              role: "assistant" as const,
              content: (m.content ?? "") as string,
            }))
          : [];
        const nextTranscript = [...transcript, ...replies];
        if (data.patch !== undefined) {
          const normalized = normalizePatchProposal(data.patch);
          if (normalized.patch) {
            setAssistantPendingPatch(normalized.patch);
            setAssistantApplyError(null);
          } else if (normalized.error) {
            setAssistantPendingPatch(null);
            nextTranscript.push({
              role: "assistant",
              content: `Patch proposal invalid: ${normalized.error}`,
            });
          }
        } else {
          setAssistantPendingPatch(null);
        }
        setAssistantMessages(nextTranscript);
      } catch (err) {
        setAssistantError(
          err instanceof Error ? err.message : "Assistant request failed",
        );
      } finally {
        setAssistantRunning(false);
      }
    },
    [fileContent, selectedFile],
  );

  const handleSendAssistant = useCallback(async () => {
    const text = assistantInput.trim();
    if (!text || assistantRunning) return;
    if (!selectedFile) {
      setAssistantError("Select a file to start.");
      return;
    }
    const userMessage: AssistantChatMessage = { role: "user", content: text };
    const transcript = [...assistantMessages, userMessage];
    setAssistantMessages(transcript);
    setAssistantPendingPatch(null);
    setAssistantApplyError(null);
    setAssistantInput("");
    await runAssistant(transcript);
  }, [
    assistantInput,
    assistantMessages,
    assistantRunning,
    runAssistant,
    selectedFile,
  ]);

  const handleAcceptPatch = useCallback(() => {
    if (!assistantPendingPatch) return;
    const applied = applyPatchProposal(fileContent, assistantPendingPatch);
    if (!applied.ok) {
      setAssistantApplyError(applied.error);
      return;
    }
    setAssistantApplyError(null);
    setFileContent(applied.next);
    setFileStatus("dirty");
    setAssistantPendingPatch(null);
    setAssistantMessages((prev) => [
      ...prev,
      { role: "system", content: "Applied patch." },
    ]);
  }, [assistantPendingPatch, fileContent]);

  const handleRejectPatch = useCallback(async () => {
    if (!assistantPendingPatch || assistantRunning) return;
    const reason = assistantRejectReason.trim();
    const rejection: AssistantChatMessage = {
      role: "user",
      content: reason ? `Rejected patch: ${reason}` : "Rejected patch.",
    };
    const transcript = [...assistantMessages, rejection];
    setAssistantMessages(transcript);
    setAssistantPendingPatch(null);
    setAssistantRejectReason("");
    setAssistantApplyError(null);
    await runAssistant(transcript);
  }, [
    assistantPendingPatch,
    assistantRejectReason,
    assistantMessages,
    assistantRunning,
    runAssistant,
  ]);

  useEffect(() => {
    const el = assistantThreadRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [assistantMessages.length]);

  const toggleDir = useCallback((relative: string) => {
    setExpandedDirs((prev) => ({
      ...prev,
      [relative]: !prev[relative],
    }));
  }, []);

  const renderFileNode = useCallback(
    (node: FileTreeNode, depth: number) => {
      const isDir = node.kind === "dir";
      const expanded = fileQuery
        ? true
        : expandedDirs[node.relative] ?? depth < 1;
      const canOpen = !isDir && node.path && isAllowedFile(node.path);
      const isSelected = !isDir && node.path === selectedFile;
      return (
        <div key={node.relative}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 6px",
              borderRadius: 8,
              background: isSelected ? "#e0f2fe" : "transparent",
              marginBottom: 2,
              paddingLeft: 6 + depth * 12,
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (isDir) return toggleDir(node.relative);
                if (!canOpen || !node.path) return;
                loadFile(node.path);
              }}
              disabled={isDir ? false : !canOpen}
              title={node.relative}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 6,
                textAlign: "left",
                border: "none",
                background: "transparent",
                padding: "2px 6px",
                cursor: isDir || canOpen ? "pointer" : "not-allowed",
                opacity: isDir || canOpen ? 1 : 0.5,
                fontWeight: isDir ? 700 : 500,
                color: isDir ? "#0f172a" : "#1f2937",
              }}
            >
              <span
                style={{
                  width: 14,
                  textAlign: "center",
                  color: "#94a3b8",
                  fontSize: 12,
                }}
              >
                {isDir ? (expanded ? "▾" : "▸") : "•"}
              </span>
              {node.name}
            </button>
            <select
              value=""
              onChange={(e) => {
                const value = e.target.value as "" | "rename" | "delete";
                if (!value) return;
                if (value === "rename") {
                  handleRenameEntry(node.relative);
                } else {
                  handleDeleteEntry(node.relative, node.kind);
                }
                e.currentTarget.value = "";
              }}
              disabled={filesBusy}
              title="Actions"
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                padding: "2px 6px",
                fontSize: 11,
                background: "white",
                cursor: "pointer",
              }}
            >
              <option value="">Actions</option>
              <option value="rename">Rename</option>
              <option value="delete">Delete</option>
            </select>
          </div>
          {isDir && expanded && node.children.length > 0 && (
            <div>
              {node.children.map((child) => renderFileNode(child, depth + 1))}
            </div>
          )}
          {isDir && expanded && node.children.length === 0 && (
            <div
              style={{
                paddingLeft: 22 + depth * 12,
                fontSize: 12,
                color: "#94a3b8",
                marginBottom: 4,
              }}
            >
              Empty folder
            </div>
          )}
        </div>
      );
    },
    [
      expandedDirs,
      fileQuery,
      filesBusy,
      handleDeleteEntry,
      handleRenameEntry,
      isAllowedFile,
      loadFile,
      selectedFile,
      toggleDir,
    ],
  );

  return (
    <div className="editor-shell">
      <div className="editor-header">
        <div>
          <h1 className="editor-title">Gambit Editor</h1>
          <div className="editor-status">
            Active deck: {config.activeDeckPath
              ? <code>{config.activeDeckPath}</code>
              : "not set"}
          </div>
        </div>
      </div>
      <div className="editor-main">
        <div
          className="editor-panel"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div className="panel-tabs">
            <button
              type="button"
              className={classNames(
                "panel-tab",
                leftTab === "files" && "active",
              )}
              onClick={() => setLeftTab("files")}
            >
              Files
            </button>
            <button
              type="button"
              className={classNames(
                "panel-tab",
                leftTab === "iteration" && "active",
              )}
              onClick={() => setLeftTab("iteration")}
            >
              Iteration
            </button>
          </div>
          {leftTab === "files"
            ? (
              <>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <strong>Files</strong>
                    <span className="editor-status">
                      {filesLoading ? "Loading..." : `${files.length} items`}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <input
                      value={rootInput}
                      onChange={(e) => setRootInput(e.target.value)}
                      placeholder="Root path (default: CWD)"
                      style={{
                        flex: 1,
                        minWidth: 180,
                        padding: 8,
                        borderRadius: 8,
                        border: "1px solid #cbd5e1",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateConfig({ ...config, rootPath: rootInput })}
                      disabled={filesBusy}
                    >
                      Save root
                    </button>
                    <button
                      type="button"
                      onClick={refreshFiles}
                      disabled={filesBusy}
                    >
                      Refresh
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <input
                      value={fileQuery}
                      onChange={(e) => setFileQuery(e.target.value)}
                      placeholder="Search files and folders"
                      style={{
                        flex: 1,
                        minWidth: 180,
                        padding: 8,
                        borderRadius: 8,
                        border: "1px solid #cbd5e1",
                      }}
                    />
                    <select
                      value=""
                      onChange={(e) => {
                        const value = e.target.value as
                          | ""
                          | "file"
                          | "dir";
                        if (!value) return;
                        handleCreateEntry(value);
                        e.currentTarget.value = "";
                      }}
                      disabled={filesBusy}
                      style={{
                        border: "1px solid #cbd5e1",
                        borderRadius: 8,
                        padding: "6px 10px",
                        background: "white",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      <option value="">New…</option>
                      <option value="file">File</option>
                      <option value="dir">Folder</option>
                    </select>
                  </div>
                </div>
                {filesLoading && (
                  <div className="placeholder">Loading files…</div>
                )}
                {filesError && <div className="error">{filesError}</div>}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  {filteredFileTree.map((node) => renderFileNode(node, 0))}
                  {!filesLoading && filteredFileTree.length === 0 && (
                    <div className="placeholder">
                      {fileQuery.trim()
                        ? "No matches."
                        : "No files under this root."}
                    </div>
                  )}
                </div>
              </>
            )
            : (
              config.activeDeckPath
                ? (
                  <>
                    <label style={{ fontSize: 13, fontWeight: 600 }}>
                      Deck notes (.gambit/notes)
                    </label>
                    <textarea
                      value={notesContent}
                      onChange={(e) => {
                        setNotesContent(e.target.value);
                        setNotesStatus("dirty");
                      }}
                      style={{
                        width: "100%",
                        height: 160,
                        resize: "vertical",
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                      }}
                      placeholder="Deck-level notes (local only)"
                    />
                    <div className="editor-status">
                      {notesStatus === "saving"
                        ? "Saving…"
                        : notesStatus === "dirty"
                        ? "Unsaved changes"
                        : notesStatus === "saved"
                        ? "Saved"
                        : notesStatus === "error"
                        ? "Save failed"
                        : "Idle"}
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                      <FeedbackList
                        items={feedback}
                        showArchived={showArchived}
                        archivingKey={archiving}
                        loading={feedbackLoading}
                        error={feedbackError}
                        onToggleShowArchived={(next) => setShowArchived(next)}
                        onView={(sessionId, messageRefId) =>
                          openSessionDrawer(sessionId, messageRefId)}
                        onArchive={(sessionId, messageRefId, archived) =>
                          archiveFeedback(sessionId, messageRefId, archived)}
                      />
                    </div>
                  </>
                )
                : (
                  <p className="placeholder">
                    Set an active deck to edit notes and view feedback.
                  </p>
                )
            )}
        </div>
        <div
          className="editor-panel"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <strong>Editor</strong>
          {selectedFile
            ? (
              <>
                <div
                  style={{
                    fontSize: 12,
                    color: "#475569",
                    wordBreak: "break-all",
                  }}
                >
                  {selectedFile}
                </div>
                <textarea
                  value={fileContent}
                  onChange={(e) => {
                    setFileContent(e.target.value);
                    setFileStatus("dirty");
                  }}
                  style={{
                    width: "100%",
                    flex: 1,
                    minHeight: 0,
                    resize: "none",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                  }}
                />
                <div className="editor-status">
                  {fileStatus === "saving"
                    ? "Saving…"
                    : fileStatus === "dirty"
                    ? "Unsaved changes"
                    : fileStatus === "saved"
                    ? "Saved"
                    : fileStatus === "error"
                    ? "Save failed"
                    : "Idle"}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedFile) {
                        const nextRoot = pathDirname(selectedFile);
                        setRootInput(nextRoot);
                        loadFiles(nextRoot);
                        updateConfig({
                          ...config,
                          activeDeckPath: selectedFile,
                          rootPath: nextRoot,
                        });
                      }
                    }}
                    className={classNames(
                      "ghost-btn",
                      config.activeDeckPath === selectedFile && "active",
                    )}
                  >
                    Set as active deck
                  </button>
                  <button type="button" onClick={onNavigateToSimulator}>
                    Open debug
                  </button>
                </div>
              </>
            )
            : <p className="placeholder">Select a file to edit.</p>}
        </div>
        <div
          className="editor-panel"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div className="panel-tabs">
            <button
              type="button"
              className={classNames(
                "panel-tab",
                rightTab === "quick-chat" && "active",
              )}
              onClick={() => setRightTab("quick-chat")}
            >
              Quick Chat
            </button>
            <button
              type="button"
              className={classNames(
                "panel-tab",
                rightTab === "assistant" && "active",
              )}
              onClick={() => setRightTab("assistant")}
            >
              Editor Assistant
            </button>
          </div>
          {rightTab === "assistant"
            ? selectedFile
              ? (
                <>
                  <div className="editor-status" style={{ gap: 4 }}>
                    Editor assistant target: <code>{selectedFile}</code>
                  </div>
                  {assistantPendingPatch && (
                    <div className="patch-card">
                      <div className="patch-summary">
                        {assistantPendingPatch.summary}
                      </div>
                      <div className="patch-meta">
                        Proposed changes ready ·{" "}
                        {assistantPendingPatch.edits.length} edit
                        {assistantPendingPatch.edits.length === 1 ? "" : "s"}
                      </div>
                      {assistantApplyError && (
                        <div className="error">{assistantApplyError}</div>
                      )}
                      <input
                        className="patch-reason-input"
                        value={assistantRejectReason}
                        onChange={(e) =>
                          setAssistantRejectReason(e.target.value)}
                        placeholder="Short reason to share (optional)"
                      />
                      <div className="patch-actions">
                        <button type="button" onClick={handleAcceptPatch}>
                          Accept
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={handleRejectPatch}
                          disabled={assistantRunning}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                  <div
                    className="imessage-thread assistant-thread"
                    ref={assistantThreadRef}
                  >
                    {assistantMessages.length === 0 && (
                      <div className="placeholder">
                        Ask for changes to get started.
                      </div>
                    )}
                    {assistantMessages.map((m, idx) => (
                      <div
                        key={`${m.role}-${idx}-${m.content.slice(0, 12)}`}
                        className={`imessage-row ${
                          m.role === "user" ? "right" : "left"
                        }`}
                      >
                        <div
                          className={`imessage-bubble ${
                            m.role === "user" ? "right" : "left"
                          }`}
                          title={m.role}
                        >
                          {m.content}
                        </div>
                      </div>
                    ))}
                  </div>
                  {assistantError && (
                    <div className="error">{assistantError}</div>
                  )}
                  <textarea
                    value={assistantInput}
                    onChange={(e) => setAssistantInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.shiftKey) return;
                      if (!assistantInput.trim().length || assistantRunning) {
                        return;
                      }
                      e.preventDefault();
                      handleSendAssistant();
                    }}
                    style={{
                      width: "100%",
                      minHeight: 96,
                      resize: "vertical",
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #cbd5e1",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                    }}
                    placeholder="Ask the assistant to update this file"
                  />
                  <div className="assistant-actions">
                    <button
                      type="button"
                      onClick={handleSendAssistant}
                      disabled={!assistantInput.trim().length ||
                        assistantRunning}
                    >
                      {assistantRunning ? "Sending…" : "Send"}
                    </button>
                    <div className="editor-status">
                      {assistantRunning ? "Waiting for assistant…" : "Idle"}
                    </div>
                  </div>
                </>
              )
              : <p className="placeholder">Select a file to start.</p>
            : (
              <>
                <div className="editor-status">
                  Status: {quickSimulator.connectionStatus}
                </div>
                {quickSessionId && (
                  <div className="editor-status">
                    Session: <code>{quickSessionId}</code>
                  </div>
                )}
                {quickSchemaError && (
                  <div className="error">{quickSchemaError}</div>
                )}
                {quickSchemaShape && (
                  <details className="init-panel" open={!quickHasState}>
                    <summary>Init (gambit_init)</summary>
                    <div className="hint">
                      Provide input for the active deck. Use form fields or raw
                      JSON; leave blank to skip.
                    </div>
                    <div className="panel-tabs" style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className={classNames(
                          "panel-tab",
                          quickInitMode === "form" && "active",
                        )}
                        onClick={() => {
                          setQuickInitMode("form");
                          setQuickInitJsonError(null);
                          setQuickJsonErrors((prev) => ({
                            ...prev,
                            __root__: null,
                          }));
                        }}
                      >
                        Form
                      </button>
                      <button
                        type="button"
                        className={classNames(
                          "panel-tab",
                          quickInitMode === "json" && "active",
                        )}
                        onClick={() => {
                          setQuickInitMode("json");
                          try {
                            setQuickInitJsonText(
                              quickInitValue === undefined
                                ? ""
                                : JSON.stringify(quickInitValue, null, 2),
                            );
                          } catch {
                            setQuickInitJsonText(
                              quickInitValue ? String(quickInitValue) : "",
                            );
                          }
                        }}
                      >
                        JSON
                      </button>
                    </div>
                    {quickInitMode === "form"
                      ? (
                        <InitForm
                          schema={quickSchemaShape}
                          value={quickInitValue}
                          onChange={(next) => {
                            setQuickInitValue(next);
                            setQuickInitDirty(true);
                          }}
                          onJsonErrorChange={(pathKey, err) =>
                            setQuickJsonErrors((prev) =>
                              prev[pathKey] === err
                                ? prev
                                : { ...prev, [pathKey]: err }
                            )}
                        />
                      )
                      : (
                        <div className="init-field">
                          <label>
                            <span>Init JSON</span>
                            <span className="badge">root</span>
                          </label>
                          <textarea
                            className="json-input"
                            value={quickInitJsonText}
                            placeholder="Paste full init JSON payload"
                            onChange={(e) => {
                              const text = e.target.value;
                              let error: string | null = null;
                              let parsed: unknown = undefined;
                              if (text.trim() === "") {
                                parsed = undefined;
                              } else {
                                try {
                                  parsed = JSON.parse(text);
                                } catch (err) {
                                  error = err instanceof Error
                                    ? err.message
                                    : "Invalid JSON";
                                }
                              }
                              setQuickInitMode("json");
                              setQuickInitJsonText(text);
                              setQuickInitJsonError(error);
                              setQuickInitDirty(true);
                              if (!error) {
                                setQuickInitValue(parsed);
                                setQuickJsonErrors((prev) => ({
                                  ...prev,
                                  __root__: null,
                                }));
                              } else {
                                setQuickJsonErrors((prev) => ({
                                  ...prev,
                                  __root__: error,
                                }));
                              }
                            }}
                            style={{ minHeight: 140 }}
                          />
                          {quickInitJsonError && (
                            <div className="error">{quickInitJsonError}</div>
                          )}
                          {!quickInitJsonError && (
                            <div className="secondary-note">
                              Leave blank to unset init. Parsed JSON replaces
                              the form.
                            </div>
                          )}
                        </div>
                      )}
                  </details>
                )}
                {!quickSchemaShape && !quickSchema.loading && (
                  <div className="placeholder">
                    No input schema; you can start with a blank message.
                  </div>
                )}
                <div
                  className="imessage-thread"
                  ref={quickThreadRef}
                >
                  {quickMessages.length === 0 && (
                    <div className="placeholder">
                      No messages yet. Send a message or start a blank run.
                    </div>
                  )}
                  {quickMessages.map((entry, idx) => (
                    (() => {
                      const role = entry.message.role ?? "assistant";
                      const isUser = role === "user";
                      const isCollapsible = role === "system" ||
                        role === "tool";
                      const isMuted = role === "system" || role === "tool";
                      const messageRefId = entry.id;
                      const expandKey = `${
                        quickSessionId ?? "local"
                      }-${idx}-${role}`;
                      const isCollapsed = isCollapsible &&
                        !quickExpanded[expandKey];
                      const content = String(entry.message.content ?? "");
                      if (!content.trim()) return null;
                      const preview = content.trim().slice(0, 160);
                      const collapsedText = `${role} message (click to expand)${
                        preview
                          ? ` - ${preview}${content.length > 160 ? "..." : ""}`
                          : ""
                      }`;
                      const toggleCollapsed = () => {
                        if (!isCollapsible) return;
                        setQuickExpanded((prev) => ({
                          ...prev,
                          [expandKey]: !prev[expandKey],
                        }));
                      };
                      return (
                        <div
                          key={`${role}-${idx}`}
                          className={`imessage-row ${
                            isUser ? "right" : "left"
                          }`}
                        >
                          <div
                            className={classNames(
                              "imessage-bubble",
                              isUser ? "right" : "left",
                              isCollapsible && "imessage-bubble-collapsible",
                              isCollapsed && "imessage-bubble-collapsed",
                              isMuted && "imessage-bubble-muted",
                            )}
                            title={role}
                            role={isCollapsible ? "button" : undefined}
                            tabIndex={isCollapsible ? 0 : -1}
                            onClick={toggleCollapsed}
                            onKeyDown={(e) => {
                              if (!isCollapsible) return;
                              if (e.key !== "Enter" && e.key !== " ") return;
                              e.preventDefault();
                              toggleCollapsed();
                            }}
                          >
                            {isCollapsed ? collapsedText : content}
                            {messageRefId && !isCollapsible && !isUser && (
                              <FeedbackControls
                                messageRefId={messageRefId}
                                feedback={entry.feedback}
                                onScore={handleQuickScore}
                                onReasonChange={handleQuickReason}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })()
                  ))}
                  {quickSimulator.streamText.length > 0 && (
                    <div className="imessage-row left">
                      <div className="imessage-bubble left" title="assistant">
                        {quickSimulator.streamText}
                      </div>
                    </div>
                  )}
                </div>
                <textarea
                  value={quickMessage}
                  onChange={(e) => setQuickMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey) return;
                    if (!quickCanSendNow) return;
                    e.preventDefault();
                    handleQuickSend();
                  }}
                  style={{
                    width: "100%",
                    minHeight: 96,
                    resize: "vertical",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                  }}
                  placeholder="Optional message (assistant can start)"
                />
                {quickMissingRequired.length > 0 && quickIncludeInit && (
                  <div className="error">
                    Missing required init fields:{" "}
                    {quickMissingRequired.slice(0, 6).join(", ")}
                    {quickMissingRequired.length > 6 ? "…" : ""}
                  </div>
                )}
                {quickJsonErrorCount > 0 && (
                  <div className="error">Fix invalid init fields to run.</div>
                )}
                {quickPendingReset && (
                  <div className="reset-note">
                    Next message will start a new chat.
                  </div>
                )}
                <div className="assistant-actions">
                  <button
                    type="button"
                    onClick={handleQuickSend}
                    disabled={!quickCanSendNow}
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      if (!quickSessionId) return;
                      window.location.assign(
                        `/debug/sessions/${encodeURIComponent(quickSessionId)}`,
                      );
                    }}
                    disabled={!quickSessionId}
                    title={quickSessionId
                      ? "Open this session in the debugger"
                      : "No active session yet"}
                  >
                    Open debug
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      setQuickPendingReset(true);
                      quickSimulator.resetLocal();
                      setQuickInitDirty(false);
                      setQuickInitMode("form");
                      setQuickInitJsonText("");
                      setQuickInitJsonError(null);
                      setQuickJsonErrors({});
                    }}
                  >
                    New chat
                  </button>
                </div>
                {quickSimulator.errors.map((err, idx) => (
                  <div key={idx} className="error">
                    {err}
                  </div>
                ))}
              </>
            )}
        </div>
      </div>
      <SessionDrawer
        open={drawerOpen}
        loading={drawerLoading}
        error={drawerError}
        context={drawerContext}
        session={drawerSession}
        showFull={drawerShowFull}
        notesStatus={drawerNotesStatus}
        onToggleShowFull={handleToggleDrawerShowFull}
        onClose={() => setDrawerOpen(false)}
        onSaveNotes={(sessionId, text) => saveDrawerNotes(sessionId, text)}
      />
    </div>
  );
}

function TestBotApp(props: {
  onNavigateToSimulator: () => void;
  onNavigateToSession: (sessionId: string) => void;
}) {
  const { onNavigateToSimulator, onNavigateToSession } = props;
  const [config, setConfig] = useState<
    { activeDeckPath?: string; rootPath?: string }
  >({});
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [botContent, setBotContent] = useState("");
  const [botDefaults, setBotDefaults] = useState<TestBotDefaults>({});
  const [botInputSchema, setBotInputSchema] = useState<NormalizedSchema | null>(
    null,
  );
  const [botInputSchemaError, setBotInputSchemaError] = useState<string | null>(
    null,
  );
  const [botInputValue, setBotInputValue] = useState<unknown>(undefined);
  const [botInputDirty, setBotInputDirty] = useState(false);
  const [botInputJsonErrors, setBotInputJsonErrors] = useState<
    Record<string, string | null>
  >({});
  const [botStatus, setBotStatus] = useState<
    "loading" | "dirty" | "saving" | "saved" | "error"
  >("loading");
  const [initialUserMessage, setInitialUserMessage] = useState("");
  const [run, setRun] = useState<TestBotRun>({
    status: "idle",
    messages: [],
  });
  const runRef = useRef<TestBotRun>({
    status: "idle",
    messages: [],
  });
  const [streamingUser, setStreamingUser] = useState<
    {
      runId: string;
      turn: number;
      text: string;
      expectedUserCount?: number;
    } | null
  >(null);
  const [streamingAssistant, setStreamingAssistant] = useState<
    {
      runId: string;
      turn: number;
      text: string;
    } | null
  >(null);
  const deckSchema = useHttpSchema();
  const deckInputSchema = deckSchema.schemaResponse?.schema;
  const deckSchemaDefaults = deckSchema.schemaResponse?.defaults;
  const deckSchemaError = deckSchema.schemaResponse?.error ??
    deckSchema.error ??
    undefined;
  const [deckInitValue, setDeckInitValue] = useState<unknown>(undefined);
  const [deckInitDirty, setDeckInitDirty] = useState(false);
  const [deckJsonErrors, setDeckJsonErrors] = useState<
    Record<string, string | null>
  >({});
  const [botPath, setBotPath] = useState<string | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const runIdRef = useRef<string | undefined>(undefined);
  const wsUrl = useMemo(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${window.location.host}/websocket`;
  }, []);

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      setConfig(data ?? {});
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const loadTestBot = useCallback(async () => {
    setBotStatus("loading");
    try {
      const res = await fetch("/api/test-bot");
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as {
        path?: string;
        content?: string;
        defaults?: TestBotDefaults;
        inputSchema?: NormalizedSchema;
        inputSchemaError?: string;
      };
      setBotContent(data.content ?? "");
      setBotDefaults(data.defaults ?? {});
      setBotInputSchema(data.inputSchema ?? null);
      setBotInputSchemaError(
        typeof data.inputSchemaError === "string"
          ? data.inputSchemaError
          : null,
      );
      setBotPath(typeof data.path === "string" ? data.path : null);
      setBotInputDirty(false);
      setBotInputJsonErrors({});
      setBotInputValue(data.defaults?.input);
      setBotStatus("saved");
    } catch (err) {
      setBotContent("");
      setBotStatus("error");
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadTestBot();
  }, [loadTestBot]);

  useEffect(() => {
    runIdRef.current = run.id;
    runRef.current = run;
    setStreamingUser(null);
    setStreamingAssistant(null);
  }, [run.id]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "testBotSubscribe" }));
    };

    ws.onmessage = (event) => {
      let msg: TestBotSocketMessage | null = null;
      try {
        msg = JSON.parse(event.data) as TestBotSocketMessage;
      } catch {
        return;
      }
      if (!msg) return;
      const activeRunId = runIdRef.current;
      if (msg.type === "testBotStatus" && msg.run) {
        if (activeRunId && msg.run.id === activeRunId) {
          setRun({
            ...msg.run,
            messages: msg.run.messages ?? [],
          });
        }
        return;
      }
      if (msg.type === "testBotStream") {
        if (!msg.runId || (activeRunId && msg.runId !== activeRunId)) return;
        const streamRunId = msg.runId;
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        if (msg.role === "user") {
          const expectedUserCount = countUserMessages(runRef.current.messages) +
            1;
          setStreamingUser((prev) =>
            prev && prev.runId === streamRunId && prev.turn === turn
              ? { ...prev, text: prev.text + msg.chunk }
              : {
                runId: streamRunId,
                turn,
                text: msg.chunk,
                expectedUserCount,
              }
          );
        } else {
          setStreamingAssistant((prev) =>
            prev && prev.runId === streamRunId && prev.turn === turn
              ? { ...prev, text: prev.text + msg.chunk }
              : { runId: streamRunId, turn, text: msg.chunk }
          );
        }
        return;
      }
      if (msg.type === "testBotStreamEnd") {
        if (!msg.runId || (activeRunId && msg.runId !== activeRunId)) return;
        const streamRunId = msg.runId;
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        if (msg.role === "user") {
          setStreamingUser((prev) => {
            if (!prev || prev.runId !== streamRunId || prev.turn !== turn) {
              return prev;
            }
            return prev.expectedUserCount ? prev : {
              ...prev,
              expectedUserCount: countUserMessages(runRef.current.messages) +
                1,
            };
          });
        } else {
          setStreamingAssistant((prev) =>
            prev && prev.runId === streamRunId && prev.turn === turn
              ? null
              : prev
          );
        }
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    ws.onerror = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
    };
  }, [wsUrl]);

  useEffect(() => {
    if (botStatus !== "dirty") return;
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(async () => {
      setBotStatus("saving");
      try {
        await fetch("/api/test-bot", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: botContent }),
        });
        setBotStatus("saved");
      } catch (err) {
        setBotStatus("error");
        console.error(err);
      }
    }, 700);
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [botStatus, botContent]);

  const refreshStatus = useCallback(async (runIdOverride?: string) => {
    try {
      const runId = runIdOverride ?? run.id;
      const res = await fetch(
        runId
          ? `/api/test-bot/status?runId=${encodeURIComponent(runId)}`
          : "/api/test-bot/status",
      );
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as {
        run?: TestBotRun;
        defaults?: TestBotDefaults;
      };
      if (data.defaults) setBotDefaults(data.defaults);
      const nextRun = data.run ?? { status: "idle", messages: [] };
      setRun({
        ...nextRun,
        messages: nextRun.messages ?? [],
      });
    } catch (err) {
      console.error(err);
    }
  }, [run.id]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!botInputSchema) return;
    if (botInputDirty) return;
    const nextBotInput = botDefaults.input !== undefined
      ? cloneValue(botDefaults.input)
      : deriveInitialFromSchema(botInputSchema);
    setBotInputValue(nextBotInput);
  }, [botInputSchema, botInputDirty, botDefaults.input]);

  useEffect(() => {
    if (!deckInputSchema) return;
    if (deckInitDirty) return;
    const nextInit = deckSchemaDefaults !== undefined
      ? cloneValue(deckSchemaDefaults)
      : deriveInitialFromSchema(deckInputSchema);
    setDeckInitValue(nextInit);
  }, [deckInputSchema, deckSchemaDefaults, deckInitDirty]);

  const missingBotInput = useMemo(() => {
    if (!botInputSchema) return [];
    return findMissingRequiredFields(botInputSchema, botInputValue);
  }, [botInputSchema, botInputValue]);

  const botJsonErrorCount = useMemo(() => {
    return Object.values(botInputJsonErrors).filter((v) =>
      typeof v === "string" && v
    )
      .length;
  }, [botInputJsonErrors]);

  const missingDeckInit = useMemo(() => {
    if (!deckInputSchema) return [];
    return findMissingRequiredFields(deckInputSchema, deckInitValue);
  }, [deckInputSchema, deckInitValue]);

  const deckJsonErrorCount = useMemo(() => {
    return Object.values(deckJsonErrors).filter((v) =>
      typeof v === "string" && v
    )
      .length;
  }, [deckJsonErrors]);

  const canStart = (!botInputSchema || missingBotInput.length === 0) &&
    (!deckInputSchema || missingDeckInit.length === 0) &&
    botJsonErrorCount === 0 &&
    deckJsonErrorCount === 0;

  useEffect(() => {
    if (run.status !== "running") {
      if (pollRef.current) window.clearInterval(pollRef.current);
      return;
    }
    pollRef.current = window.setInterval(() => {
      refreshStatus();
    }, 1500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [run.status, refreshStatus]);

  useEffect(() => {
    if (
      streamingUser?.expectedUserCount !== undefined &&
      streamingUser.runId === run.id &&
      countUserMessages(run.messages) >= streamingUser.expectedUserCount
    ) {
      setStreamingUser(null);
    }
    if (run.status !== "running" && streamingUser) {
      setStreamingUser(null);
    }
    const el = transcriptRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    run.id,
    run.messages,
    run.status,
    streamingUser,
    streamingAssistant?.text,
  ]);

  const startRun = useCallback(async () => {
    try {
      const res = await fetch("/api/test-bot/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          init: deckInitValue,
          botInput: botInputValue,
          initialUserMessage,
        }),
      });
      const data = await res.json() as { run?: TestBotRun };
      if (data.run) {
        setRun({ ...data.run, messages: data.run.messages ?? [] });
      } else {
        setRun({ status: "running", messages: [] });
      }
      refreshStatus(data.run?.id);
    } catch (err) {
      console.error(err);
    }
  }, [deckInitValue, botInputValue, initialUserMessage, refreshStatus]);

  const stopRun = useCallback(async () => {
    if (!run.id) return;
    try {
      await fetch("/api/test-bot/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
    } catch (err) {
      console.error(err);
    } finally {
      refreshStatus(run.id);
    }
  }, [refreshStatus, run.id]);

  const saveTestBotFeedback = useCallback(
    async (messageRefId: string, score: number, reason?: string) => {
      if (!run.sessionId) return;
      try {
        const res = await fetch("/api/session/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: run.sessionId,
            messageRefId,
            score,
            reason,
          }),
        });
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json() as { feedback?: FeedbackEntry };
        if (data.feedback) {
          setRun((prev) => ({
            ...prev,
            messages: prev.messages.map((msg) =>
              msg.messageRefId === messageRefId
                ? { ...msg, feedback: data.feedback }
                : msg
            ),
          }));
        }
      } catch (err) {
        console.error(err);
      }
    },
    [run.sessionId],
  );

  const handleTestBotScore = useCallback(
    (messageRefId: string, score: number) => {
      saveTestBotFeedback(messageRefId, score);
    },
    [saveTestBotFeedback],
  );

  const handleTestBotReason = useCallback(
    (messageRefId: string, score: number, reason: string) => {
      saveTestBotFeedback(messageRefId, score, reason);
    },
    [saveTestBotFeedback],
  );

  const runStatusLabel = run.status === "running"
    ? "Running test bot…"
    : run.status === "completed"
    ? "Completed"
    : run.status === "error"
    ? "Failed"
    : run.status === "canceled"
    ? "Stopped"
    : "Idle";

  return (
    <div className="editor-shell">
      <div className="editor-header">
        <div>
          <h1 className="editor-title">Test Bot</h1>
          <div className="editor-status">
            Active deck: {loadingConfig
              ? "Loading…"
              : config.activeDeckPath
              ? <code>{config.activeDeckPath}</code>
              : "not set"}
          </div>
        </div>
        <div className="header-actions">
          <button type="button" onClick={onNavigateToSimulator}>
            Open debug
          </button>
        </div>
      </div>
      <div className="editor-main">
        <div
          className="editor-panel"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <strong>Scenario (Test Bot input)</strong>
          {botInputSchemaError && (
            <div className="error">{botInputSchemaError}</div>
          )}
          {botInputSchema && (
            <InitForm
              schema={botInputSchema}
              value={botInputValue}
              onChange={(next) => {
                setBotInputValue(next);
                setBotInputDirty(true);
              }}
              onJsonErrorChange={(pathKey, err) =>
                setBotInputJsonErrors((prev) =>
                  prev[pathKey] === err ? prev : { ...prev, [pathKey]: err }
                )}
            />
          )}
          {!botInputSchema && (
            <div className="placeholder">
              No test bot input schema configured.
            </div>
          )}
          <strong>Initial user message (optional)</strong>
          <textarea
            value={initialUserMessage}
            onChange={(e) => setInitialUserMessage(e.target.value)}
            style={{
              width: "100%",
              minHeight: 90,
              resize: "vertical",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              fontFamily: "inherit",
            }}
            placeholder="If provided, this is sent as the first user message."
          />
          <strong>
            Test bot deck ({botPath ?? ".gambit/test-bot.md"})
          </strong>
          <textarea
            value={botContent}
            onChange={(e) => {
              setBotContent(e.target.value);
              setBotStatus("dirty");
            }}
            style={{
              width: "100%",
              flex: 1,
              minHeight: 0,
              resize: "none",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            }}
            placeholder="Define the QA bot persona and model params (TOML front matter)."
          />
          <div className="editor-status">
            {botStatus === "saving"
              ? "Saving…"
              : botStatus === "dirty"
              ? "Unsaved changes"
              : botStatus === "saved"
              ? "Saved"
              : botStatus === "error"
              ? "Save failed"
              : "Loading…"}
          </div>
          <div style={{ fontSize: 12, color: "#475569" }}>
            Defaults: model {botDefaults.model ?? "gpt-4o"}, temperature{" "}
            {botDefaults.temperature ?? 0.2}, max turns{" "}
            {botDefaults.maxTurns ?? 20}
          </div>
        </div>
        <div
          className="editor-panel"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <strong>Latest test run</strong>
          <div className="editor-status">{runStatusLabel}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={startRun} disabled={!canStart}>
              Run test bot
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={stopRun}
              disabled={run.status !== "running"}
            >
              Stop
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => refreshStatus()}
            >
              Refresh
            </button>
          </div>
          {run.error && <div className="error">{run.error}</div>}
          {run.sessionId && (
            <div className="editor-status">
              Session: <code>{run.sessionId}</code>
            </div>
          )}
          {run.sessionId && (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onNavigateToSession(run.sessionId!)}
            >
              Open in debug
            </button>
          )}
          {!canStart && (
            <div className="error">
              {botJsonErrorCount > 0 || deckJsonErrorCount > 0
                ? "Fix invalid JSON fields to run."
                : missingBotInput.length > 0
                ? `Missing required bot inputs: ${
                  missingBotInput.slice(0, 6).join(", ")
                }${missingBotInput.length > 6 ? "…" : ""}`
                : missingDeckInit.length > 0
                ? `Missing required init fields: ${
                  missingDeckInit.slice(0, 6).join(", ")
                }${missingDeckInit.length > 6 ? "…" : ""}`
                : ""}
            </div>
          )}
          <div
            className="imessage-thread"
            ref={transcriptRef}
          >
            {run.messages.length === 0 && (
              <div className="placeholder">No messages yet.</div>
            )}
            {run.messages.map((m, idx) => (
              <div
                key={`${m.role}-${idx}`}
                className={`imessage-row ${
                  m.role === "user" ? "right" : "left"
                }`}
              >
                <div
                  className={`imessage-bubble ${
                    m.role === "user" ? "right" : "left"
                  }`}
                  title={m.role}
                >
                  {m.content}
                  {m.messageRefId && m.role !== "user" && run.sessionId && (
                    <FeedbackControls
                      messageRefId={m.messageRefId}
                      feedback={m.feedback}
                      onScore={handleTestBotScore}
                      onReasonChange={handleTestBotReason}
                    />
                  )}
                </div>
              </div>
            ))}
            {streamingUser?.text && streamingUser.runId === run.id &&
              (streamingUser.expectedUserCount === undefined ||
                countUserMessages(run.messages) <
                  streamingUser.expectedUserCount) &&
              (
                <div className="imessage-row right">
                  <div
                    className="imessage-bubble right imessage-bubble-muted"
                    title="user"
                  >
                    {streamingUser.text}
                  </div>
                </div>
              )}
            {streamingAssistant?.text && streamingAssistant.runId === run.id &&
              (
                <div className="imessage-row left">
                  <div
                    className="imessage-bubble left imessage-bubble-muted"
                    title="assistant"
                  >
                    {streamingAssistant.text}
                  </div>
                </div>
              )}
          </div>
        </div>
        <div
          className="editor-panel"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <strong>Deck to test</strong>
          <div className="editor-status">
            <code>{deckPath}</code>
          </div>
          <strong>Init (gambit_init)</strong>
          {deckSchema.loading && (
            <div className="editor-status">Loading schema…</div>
          )}
          {deckSchemaError && <div className="error">{deckSchemaError}</div>}
          {deckInputSchema && (
            <>
              <InitForm
                schema={deckInputSchema}
                value={deckInitValue}
                onChange={(next) => {
                  setDeckInitValue(next);
                  setDeckInitDirty(true);
                }}
                onJsonErrorChange={(pathKey, err) =>
                  setDeckJsonErrors((prev) =>
                    prev[pathKey] === err ? prev : { ...prev, [pathKey]: err }
                  )}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setDeckInitDirty(false);
                    setDeckJsonErrors({});
                    const nextInit = deckSchemaDefaults !== undefined
                      ? cloneValue(deckSchemaDefaults)
                      : deriveInitialFromSchema(deckInputSchema);
                    setDeckInitValue(nextInit);
                  }}
                >
                  Reset init
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => deckSchema.refresh()}
                >
                  Refresh schema
                </button>
              </div>
            </>
          )}
          {!deckInputSchema && !deckSchema.loading && (
            <div className="placeholder">
              No input schema found for this deck.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [bundleStamp, setBundleStamp] = useState<string | null>(null);
  const basePath = "/debug";

  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  useEffect(() => {
    const loadBundleStamp = async () => {
      try {
        const res = await fetch("/ui/bundle.js", { method: "HEAD" });
        if (!res.ok) return;
        const header = res.headers.get("last-modified");
        if (!header) return;
        const date = new Date(header);
        setBundleStamp(
          Number.isNaN(date.getTime()) ? header : date.toLocaleString(),
        );
      } catch {
        // ignore
      }
    };
    loadBundleStamp();
  }, []);

  const navigate = useCallback((next: string) => {
    if (next === path) return;
    window.history.pushState({}, "", next);
    setPath(next);
  }, [path]);

  const isSimulator = path.startsWith("/debug") ||
    path.startsWith("/simulate") ||
    path.startsWith("/sessions");
  const isTestBot = path.startsWith("/test-bot");
  const currentPage = isSimulator ? "debug" : isTestBot ? "test-bot" : "editor";

  return (
    <>
      <div className="app-root">
        <div className="top-nav">
          <button
            type="button"
            className={currentPage === "editor" ? "active" : ""}
            onClick={() => navigate("/")}
          >
            Editor
          </button>
          <button
            type="button"
            className={currentPage === "debug" ? "active" : ""}
            onClick={() => navigate(basePath)}
          >
            Debug
          </button>
          <button
            type="button"
            className={currentPage === "test-bot" ? "active" : ""}
            onClick={() => navigate("/test-bot")}
          >
            Test Bot
          </button>
          {bundleStamp && (
            <span className="bundle-stamp">Bundle: {bundleStamp}</span>
          )}
        </div>
        <div className="page-shell">
          {currentPage === "debug"
            ? <SimulatorApp basePath={basePath} />
            : currentPage === "test-bot"
            ? (
              <TestBotApp
                onNavigateToSimulator={() => navigate(basePath)}
                onNavigateToSession={(sessionId) =>
                  navigate(
                    `${basePath}/sessions/${encodeURIComponent(sessionId)}`,
                  )}
              />
            )
            : (
              <EditorApp
                onNavigateToSimulator={() => navigate(basePath)}
              />
            )}
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
