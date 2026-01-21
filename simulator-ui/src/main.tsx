import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import DocsPage from "./DocsPage.tsx";
import { globalStyles } from "./styles.ts";
import { classNames, formatTimestamp, formatTimestampShort } from "./utils.ts";

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
  testBotName?: string;
  createdAt?: string;
  sessionDir?: string;
  statePath?: string;
};

type GraderDeckMeta = {
  id: string;
  label: string;
  description?: string;
  path: string;
};

type CalibrationRun = {
  id: string;
  graderId: string;
  graderPath: string;
  graderLabel?: string;
  status: "running" | "completed" | "error";
  runAt?: string;
  referenceSample?: {
    score: number;
    reason: string;
    evidence?: string[];
  };
  input?: unknown;
  result?: unknown;
  error?: string;
};

type GradingFlag = {
  id: string;
  refId: string;
  runId?: string;
  turnIndex?: number;
  reason?: string;
  createdAt?: string;
};

type SessionDetailResponse = {
  sessionId: string;
  messages: ModelMessage[];
  messageRefs?: MessageRef[];
  feedback?: FeedbackEntry[];
  meta?: Record<string, unknown>;
};

type CalibrateSession = SessionMeta & {
  gradingRuns?: Array<CalibrationRun>;
};

type CalibrateResponse = {
  graderDecks?: Array<GraderDeckMeta>;
  sessions?: Array<CalibrateSession>;
};

type CalibrateStreamMessage = {
  type: "calibrateSession";
  sessionId: string;
  run: CalibrationRun;
  session: CalibrateSession;
};

type CalibrateRef = {
  runId?: string;
  turnIndex?: number;
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
  traces?: TraceEvent[];
  toolInserts?: Array<{
    actionCallId?: string;
    parentActionCallId?: string;
    name?: string;
    index: number;
  }>;
};

function countUserMessages(
  messages: Array<{ role: string; content: string }>,
) {
  return messages.filter((m) => m.role === "user").length;
}

function countAssistantMessages(
  messages: Array<{ role?: string; content?: unknown }>,
) {
  return messages.filter((m) => m.role === "assistant").length;
}

function extractScoreAndReason(result: unknown): {
  score?: number;
  reason?: string;
} {
  if (!result || typeof result !== "object") return {};
  const record = result as Record<string, unknown>;
  const payload = record.payload &&
      typeof record.payload === "object" &&
      record.payload !== null
    ? record.payload as Record<string, unknown>
    : record;
  const score = typeof payload.score === "number" ? payload.score : undefined;
  const reason = typeof payload.reason === "string"
    ? payload.reason
    : undefined;
  return { score, reason };
}

function extractScoreAndReasonFromSample(sample?: {
  score?: number;
  reason?: string;
}): { score?: number; reason?: string } {
  if (!sample) return {};
  return {
    score: typeof sample.score === "number" ? sample.score : undefined,
    reason: typeof sample.reason === "string" ? sample.reason : undefined,
  };
}

function extractGradingFlags(meta?: Record<string, unknown>): GradingFlag[] {
  if (!meta) return [];
  const flags = (meta as { gradingFlags?: unknown }).gradingFlags;
  if (!Array.isArray(flags)) return [];
  return flags.filter((flag): flag is GradingFlag =>
    Boolean(flag && typeof flag === "object" && "refId" in flag)
  );
}

function formatSnippet(value: unknown, maxLength = 140): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : (() => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  })();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function getScoreClass(displayScore?: number): string {
  if (displayScore === undefined) return "calibrate-score--empty";
  if (displayScore > 0) return "calibrate-score--positive";
  if (displayScore < 0) return "calibrate-score--negative";
  return "calibrate-score--neutral";
}

function extractTurnContext(input?: unknown): {
  priorUser?: string;
  gradedAssistant?: string;
} {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  const session = record.session;
  const messageToGrade = record.messageToGrade;
  const gradedAssistant = messageToGrade &&
      typeof messageToGrade === "object" &&
      typeof (messageToGrade as { content?: unknown }).content === "string"
    ? String((messageToGrade as { content?: string }).content)
    : undefined;
  const messages = session &&
      typeof session === "object" &&
      Array.isArray((session as { messages?: unknown }).messages)
    ? (session as { messages: Array<{ role?: string; content?: unknown }> })
      .messages
    : [];
  let priorUser: string | undefined = undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    if (typeof msg.content === "string") {
      priorUser = msg.content;
      break;
    }
  }
  return { priorUser, gradedAssistant };
}

function extractTotalTurns(input?: unknown): number | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const session = record.session;
  const messages = session &&
      typeof session === "object" &&
      Array.isArray((session as { messages?: unknown }).messages)
    ? (session as { messages: Array<{ role?: string; content?: unknown }> })
      .messages
    : Array.isArray((record as { messages?: unknown }).messages)
    ? (record as { messages: Array<{ role?: string; content?: unknown }> })
      .messages
    : [];
  const total = countAssistantMessages(messages);
  return total > 0 ? total : undefined;
}

function extractTotalTurnsFromResult(result?: unknown): number | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  if (record.mode !== "turns") return undefined;
  const totalTurns = typeof record.totalTurns === "number"
    ? record.totalTurns
    : undefined;
  const turns = Array.isArray(record.turns) ? record.turns : undefined;
  if (typeof totalTurns === "number") return totalTurns;
  return turns ? turns.length : undefined;
}

function isTurnsResult(result?: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  return (result as { mode?: unknown }).mode === "turns";
}

function extractConversationContext(input?: unknown): {
  latestUser?: string;
  latestAssistant?: string;
} {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  const session = record.session;
  const messages = session &&
      typeof session === "object" &&
      Array.isArray((session as { messages?: unknown }).messages)
    ? (session as { messages: Array<{ role?: string; content?: unknown }> })
      .messages
    : [];
  let latestUser: string | undefined = undefined;
  let latestAssistant: string | undefined = undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (!latestAssistant && msg.role === "assistant") {
      if (typeof msg.content === "string") {
        latestAssistant = msg.content;
      }
    }
    if (!latestUser && msg.role === "user") {
      if (typeof msg.content === "string") {
        latestUser = msg.content;
      }
    }
    if (latestUser && latestAssistant) break;
  }
  return { latestUser, latestAssistant };
}

type TestBotStreamEvent = {
  type: "testBotStream";
  runId?: string;
  role: "user" | "assistant";
  chunk: string;
  turn?: number;
  ts?: number;
};

type TestBotStreamEndEvent = {
  type: "testBotStreamEnd";
  runId?: string;
  role: "user" | "assistant";
  turn?: number;
  ts?: number;
};

type TestBotStatusEvent = {
  type: "testBotStatus";
  run?: TestBotRun;
};

type TestBotSocketMessage =
  | TestBotStreamEvent
  | TestBotStreamEndEvent
  | TestBotStatusEvent;

type TestDeckMeta = {
  id: string;
  label: string;
  description?: string;
  path: string;
};

type TestBotConfigResponse = {
  botPath?: string | null;
  botLabel?: string | null;
  botDescription?: string | null;
  selectedDeckId?: string | null;
  testDecks?: Array<TestDeckMeta>;
  inputSchema?: NormalizedSchema | null;
  inputSchemaError?: string | null;
  defaults?: { input?: unknown } | null;
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
const normalizedDeckPath = normalizeFsPath(deckPath);
const repoRootPath = guessRepoRoot(normalizedDeckPath);
const deckDisplayPath = toRelativePath(normalizedDeckPath, repoRootPath) ??
  normalizedDeckPath;
const SESSIONS_BASE_PATH = "/sessions";
const DOCS_PATH = "/docs";
const DEFAULT_SESSION_PATH = `${SESSIONS_BASE_PATH}/new/debug`;
const DEFAULT_TEST_BOT_PATH = `${SESSIONS_BASE_PATH}/new/test-bot`;
const CALIBRATE_PATH_SUFFIX = "/calibrate";
const buildCalibratePath = (sessionId: string) =>
  `${SESSIONS_BASE_PATH}/${
    encodeURIComponent(sessionId)
  }${CALIBRATE_PATH_SUFFIX}`;
const DURABLE_STREAM_PREFIX = "/api/durable-streams/stream/";
const SIMULATOR_STREAM_ID = "gambit-simulator";
const TEST_BOT_STREAM_ID = "gambit-test-bot";
const CALIBRATE_STREAM_ID = "gambit-calibrate";
function getDurableStreamOffset(streamId: string): number {
  try {
    const raw = window.localStorage.getItem(
      `gambit.durable-streams.offset.${streamId}`,
    );
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  } catch {
    return 0;
  }
}

function setDurableStreamOffset(streamId: string, offset: number) {
  try {
    window.localStorage.setItem(
      `gambit.durable-streams.offset.${streamId}`,
      String(offset),
    );
  } catch {
    // ignore storage failures
  }
}

function buildDurableStreamUrl(streamId: string, offset: number) {
  const params = new URLSearchParams({ live: "sse", offset: String(offset) });
  return `${DURABLE_STREAM_PREFIX}${
    encodeURIComponent(streamId)
  }?${params.toString()}`;
}

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
  const [connectSeq, setConnectSeq] = useState(0);

  useEffect(() => {
    const streamId = SIMULATOR_STREAM_ID;
    const streamUrl = buildDurableStreamUrl(
      streamId,
      getDurableStreamOffset(streamId),
    );
    const source = new EventSource(streamUrl);
    setConnectionStatus("connecting");

    source.onopen = () => {
      setConnectionStatus("connected");
      setErrors([]);
    };

    source.onerror = () => {
      setConnectionStatus("error");
      setErrors((prev) =>
        prev.includes("Stream connection error")
          ? prev
          : [...prev, "Stream connection error"]
      );
      setIsRunning(false);
      setStreamText("");
    };

    source.onmessage = (event) => {
      let envelope: { offset?: unknown; data?: unknown } | null = null;
      try {
        envelope = JSON.parse(event.data) as {
          offset?: unknown;
          data?: unknown;
        };
      } catch (err) {
        console.error("[sim] failed to parse stream envelope", err);
        return;
      }
      if (
        envelope &&
        typeof envelope.offset === "number" &&
        Number.isFinite(envelope.offset)
      ) {
        setDurableStreamOffset(streamId, envelope.offset + 1);
      }
      const msg = envelope?.data as SimulatorMessage | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "state") {
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
        const message = msg.message ?? "Unknown error";
        setErrors((prev) => [...prev, message]);
        if (msg.runId || message !== "Run already in progress") {
          setIsRunning(false);
        }
        setStreamText("");
      }
    };

    return () => {
      source.close();
      setConnectionStatus("closed");
      setIsRunning(false);
      setStreamText("");
    };
  }, [connectSeq]);

  const run = useCallback(
    async (opts: {
      input?: unknown;
      message?: string;
      resetState?: boolean;
      trace?: boolean;
    }) => {
      setIsRunning(true);
      setStreamText("");
      const sessionId = opts.resetState
        ? undefined
        : savedState?.meta?.sessionId;
      try {
        const res = await fetch("/api/simulator/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: opts.input,
            message: opts.message,
            resetState: opts.resetState ?? false,
            trace: opts.trace ?? true,
            stream: true,
            sessionId,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof payload?.error === "string" ? payload.error : res.statusText,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrors((prev) => [...prev, message]);
        setIsRunning(false);
        setStreamText("");
      }
    },
    [savedState?.meta?.sessionId],
  );

  const sendFeedback = useCallback(
    async (messageRefId: string, score: number, reason?: string) => {
      const sessionId = savedState?.meta?.sessionId;
      if (!sessionId) return;
      try {
        const res = await fetch("/api/simulator/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, messageRefId, score, reason }),
        });
        if (!res.ok) throw new Error(res.statusText);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrors((prev) => [...prev, message]);
      }
    },
    [savedState?.meta?.sessionId],
  );

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch("/api/simulator/load-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof payload?.error === "string" ? payload.error : res.statusText,
        );
      }
      if (payload?.state) {
        setSavedState(payload.state as SavedState);
        if (Array.isArray(payload.state.traces)) {
          setTraceEvents(payload.state.traces as TraceEvent[]);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrors((prev) => [...prev, message]);
    }
  }, []);

  const saveNotes = useCallback(
    async (text: string) => {
      const sessionId = savedState?.meta?.sessionId;
      if (!sessionId) return;
      try {
        const res = await fetch("/api/simulator/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, text }),
        });
        if (!res.ok) throw new Error(res.statusText);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrors((prev) => [...prev, message]);
      }
    },
    [savedState?.meta?.sessionId],
  );

  const saveSessionScore = useCallback(
    async (score: number) => {
      const sessionId = savedState?.meta?.sessionId;
      if (!sessionId) return;
      try {
        const res = await fetch("/api/simulator/conversation-score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, score }),
        });
        if (!res.ok) throw new Error(res.statusText);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrors((prev) => [...prev, message]);
      }
    },
    [savedState?.meta?.sessionId],
  );

  const reconnect = useCallback(() => {
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

  const deleteSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/session/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error(res.statusText);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete session",
      );
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  return { sessions, loading, error, refresh, deleteSession };
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
  basePath = SESSIONS_BASE_PATH,
): string | null {
  const target = typeof pathname === "string"
    ? pathname
    : window.location.pathname;
  const normalizedTarget = target.replace(/\/+$/, "");
  const canonical = normalizedTarget.match(
    /^\/sessions\/([^/]+)(?:\/(debug|calibrate|test-bot))?$/,
  );
  if (canonical) {
    const id = canonical[1];
    if (id && id !== "new") return decodeURIComponent(id);
    return null;
  }
  const bases = [basePath, "/debug", "/simulate", ""];
  for (const base of bases) {
    if (typeof base !== "string") continue;
    const normalized = normalizeBasePath(base);
    const prefix = `${normalized}/sessions/`.replace(/^\/\//, "/");
    if (normalized === "" && !normalizedTarget.startsWith("/sessions/")) {
      continue;
    }
    if (normalized !== "" && !normalizedTarget.startsWith(prefix)) {
      continue;
    }
    const remainder = normalized === ""
      ? normalizedTarget.slice("/sessions/".length)
      : normalizedTarget.slice(prefix.length);
    if (remainder.length > 0 && remainder !== "new") {
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

function normalizeFsPath(input?: string | null): string {
  if (!input) return "";
  return input.replace(/\\/g, "/");
}

function guessRepoRoot(path: string): string | null {
  const normalized = normalizeFsPath(path);
  const marker = "/bfmono";
  const idx = normalized.indexOf(marker);
  if (idx === -1) return null;
  return normalized.slice(0, idx + marker.length);
}

function toRelativePath(
  path?: string | null,
  repoRoot?: string | null,
): string | null {
  if (!path) return null;
  const target = normalizeFsPath(path);
  if (repoRoot) {
    const normalizedRoot = normalizeFsPath(repoRoot);
    if (target === normalizedRoot) return "";
    if (target.startsWith(`${normalizedRoot}/`)) {
      return target.slice(normalizedRoot.length + 1);
    }
  }
  return target;
}

function getCalibrateSessionIdFromLocation(): string | null {
  const pathMatch = window.location.pathname.match(
    /^\/sessions\/([^/]+)\/calibrate/,
  );
  if (pathMatch) return decodeURIComponent(pathMatch[1]);
  const legacyMatch = window.location.pathname.match(
    /^\/calibrate\/sessions\/([^/]+)/,
  );
  if (legacyMatch) return decodeURIComponent(legacyMatch[1]);
  const params = new URLSearchParams(window.location.search);
  const param = params.get("sessionId");
  return param ? decodeURIComponent(param) : null;
}

function getCalibrateRefFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  return ref && ref.trim().length ? ref.trim() : null;
}

function parseGradingRef(ref: string): {
  runId?: string;
  turnIndex?: number;
} {
  const match = ref.match(
    /^gradingRun:([^#]+)(?:#turn:(\d+))?$/i,
  );
  if (!match) return {};
  const runId = match[1];
  const turnIndex = match[2] ? Number(match[2]) : undefined;
  return {
    runId: runId || undefined,
    turnIndex: Number.isFinite(turnIndex) ? turnIndex : undefined,
  };
}

function CopyBadge(props: {
  label: string;
  displayValue?: string | null;
  copyValue?: string | null;
  className?: string;
}) {
  const { label, displayValue, copyValue, className } = props;
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const copyTarget = copyValue ?? displayValue;
  if (!copyTarget) return null;
  const text = displayValue ?? copyTarget;

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyTarget);
      } else {
        const temp = document.createElement("textarea");
        temp.value = copyTarget;
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
      }
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore copy failures silently
    }
  }, [copyTarget]);

  return (
    <button
      type="button"
      className={classNames("copy-badge", className, copied && "copied")}
      onClick={handleCopy}
      title={copied ? "Copied!" : `Click to copy ${label}`}
    >
      <span className="copy-label">{label}:</span>
      <code>{text}</code>
      {copied && <span className="copy-feedback">Copied</span>}
    </button>
  );
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

type ToolCallSummary = {
  id: string;
  name?: string;
  status: "pending" | "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
  error?: unknown;
  handledError?: string;
  parentActionCallId?: string;
  depth?: number;
};

function findHandledErrors(traces: TraceEvent[]): Map<string, string> {
  const handled = new Map<string, string>();
  const contextToolNames = new Set(["gambit_context", "gambit_init"]);
  for (const trace of traces) {
    if (!trace || typeof trace !== "object") continue;
    if (trace.type !== "tool.result") continue;
    const name = typeof (trace as { name?: unknown }).name === "string"
      ? (trace as { name?: string }).name
      : undefined;
    if (!name || !contextToolNames.has(name)) continue;
    const result = (trace as { result?: unknown }).result as
      | Record<string, unknown>
      | undefined;
    if (!result || result.kind !== "error") continue;
    const source = result.source as Record<string, unknown> | undefined;
    const actionName = typeof source?.actionName === "string"
      ? source.actionName
      : undefined;
    const errorObj = result.error as { message?: unknown } | undefined;
    const errorMessage = typeof errorObj?.message === "string"
      ? errorObj.message
      : undefined;
    if (actionName && errorMessage) {
      handled.set(actionName, errorMessage);
    }
  }
  return handled;
}

function summarizeToolCalls(traces: TraceEvent[]): ToolCallSummary[] {
  const order: ToolCallSummary[] = [];
  const byId = new Map<string, ToolCallSummary>();
  const depthMap = new Map<string, number>();
  for (const trace of traces) {
    if (!trace || typeof trace !== "object") continue;
    const type = typeof trace.type === "string" ? trace.type : "";
    const actionCallId = typeof (trace as { actionCallId?: unknown })
        .actionCallId === "string"
      ? (trace as { actionCallId?: string }).actionCallId
      : undefined;
    const parentActionCallId = typeof (trace as {
        parentActionCallId?: unknown;
      }).parentActionCallId === "string"
      ? (trace as { parentActionCallId?: string }).parentActionCallId
      : undefined;
    if (
      (type === "deck.start" || type === "action.start") && actionCallId
    ) {
      const parentDepth = parentActionCallId && depthMap.has(parentActionCallId)
        ? depthMap.get(parentActionCallId)!
        : -1;
      depthMap.set(actionCallId, parentDepth + 1);
      continue;
    }
    if (!type.startsWith("tool.") || !actionCallId) continue;
    let summary = byId.get(actionCallId);
    if (!summary) {
      summary = {
        id: actionCallId,
        name: typeof trace.name === "string" ? trace.name : undefined,
        status: "pending",
      };
      byId.set(actionCallId, summary);
      order.push(summary);
    }
    if (typeof trace.name === "string") summary.name = trace.name;
    if (type === "tool.call") {
      if ("args" in trace) {
        summary.args = (trace as { args?: unknown }).args;
      }
      summary.status = "running";
      summary.parentActionCallId = parentActionCallId;
      const parentDepth = parentActionCallId && depthMap.has(parentActionCallId)
        ? depthMap.get(parentActionCallId)!
        : -1;
      const nextDepth = parentDepth + 1;
      summary.depth = summary.depth ?? nextDepth;
      depthMap.set(actionCallId, nextDepth);
    } else if (type === "tool.result") {
      if ("result" in trace) {
        summary.result = (trace as { result?: unknown }).result;
      }
      summary.status = "completed";
    } else if (type === "tool.error") {
      if ("error" in trace) {
        summary.error = (trace as { error?: unknown }).error;
      }
      summary.status = "error";
    }
  }
  const handled = findHandledErrors(traces);
  order.forEach((summary) => {
    if (!summary.name) return;
    const errorMessage = handled.get(summary.name);
    if (errorMessage) {
      summary.handledError = errorMessage;
    }
  });
  return order;
}

function ToolCallField(props: {
  label: string;
  value: unknown;
  isError?: boolean;
}) {
  const { label, value, isError } = props;
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  return (
    <div className="tool-call-field">
      <div className="tool-call-field-label">{label}</div>
      <pre
        className={classNames(
          "trace-json",
          isError && "tool-call-error",
        )}
      >
        {text}
      </pre>
    </div>
  );
}

function ToolCallBubble(props: { call: ToolCallSummary }) {
  const { call } = props;
  const [open, setOpen] = useState(false);
  const statusLabel = call.status === "completed"
    ? "Completed"
    : call.status === "error"
    ? "Error"
    : call.status === "running"
    ? "Running"
    : "Pending";
  const indentStyle = call.depth && call.depth > 0
    ? { marginLeft: call.depth * 12 }
    : undefined;
  return (
    <div className="imessage-row left tool-call-row" style={indentStyle}>
      <div className="imessage-bubble left tool-call-bubble">
        <button
          type="button"
          className="tool-call-collapse"
          onClick={() => setOpen((prev) => !prev)}
        >
          <div className="tool-call-header">
            <div className="tool-call-title">
              Tool call: <strong>{call.name ?? call.id}</strong>
            </div>
            <div
              className={classNames(
                "tool-call-status",
                `status-${call.status}`,
              )}
            >
              {statusLabel}
            </div>
            {call.handledError && (
              <div className="tool-call-handled">Error handled</div>
            )}
          </div>
          <div className="tool-call-id">{call.id}</div>
          <div className="tool-call-expand">
            {open ? "Hide details" : "Show details"}
          </div>
        </button>
        {open && (
          <div className="tool-call-detail">
            {call.args !== undefined && (
              <ToolCallField label="Arguments" value={call.args} />
            )}
            {call.result !== undefined && (
              <ToolCallField label="Result" value={call.result} />
            )}
            {call.error !== undefined && (
              <ToolCallField label="Error" value={call.error} isError />
            )}
            {call.handledError && (
              <>
                <div className="tool-call-divider" />
                <ToolCallField
                  label="Handled error"
                  value={call.handledError}
                  isError
                />
              </>
            )}
          </div>
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
  onDelete: (sessionId: string) => void;
  onClose: () => void;
}) {
  const {
    open,
    sessions,
    loading,
    error,
    onRefresh,
    onSelect,
    onDelete,
    onClose,
  } = props;
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
                  className="session-select-button"
                  onClick={() => onSelect(session.id)}
                >
                  <strong>
                    {session.testBotName ??
                      session.deckSlug ??
                      session.deck ??
                      "session"}
                  </strong>
                  <span>{formatTimestamp(session.createdAt)}</span>
                  <code>{session.id}</code>
                </button>
                <button
                  type="button"
                  className="session-delete-button"
                  onClick={() => {
                    if (!window.confirm("Delete this session?")) return;
                    onDelete(session.id);
                  }}
                  aria-label="Delete session"
                  title="Delete session"
                >
                  X
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
              <strong>
                {session.testBotName ??
                  session.deckSlug ??
                  session.deck ??
                  "session"}
              </strong>
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
  const {
    sessions,
    loading: sessionsLoading,
    error: sessionsError,
    refresh,
    deleteSession,
  } = useSessions();
  const normalizedBase = normalizeBasePath(basePath || SESSIONS_BASE_PATH);
  const rootPath = normalizedBase === "" ? "/" : normalizedBase;
  const sessionBasePath = rootPath === "/" ? SESSIONS_BASE_PATH : rootPath;
  const normalizedSessionBase = normalizeBasePath(sessionBasePath);
  const newSessionPath = `${
    normalizedSessionBase === "" ? "/sessions" : normalizedSessionBase
  }/new`.replace(/\/{2,}/g, "/");
  const buildSessionUrl = useCallback(
    (sessionId: string) =>
      `${normalizedSessionBase === "" ? "/sessions" : normalizedSessionBase}/${
        encodeURIComponent(sessionId)
      }/debug`.replace(/\/{2,}/g, "/"),
    [normalizedSessionBase],
  );
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

  const schema = httpSchema.schemaResponse?.schema;
  const schemaDefaults = httpSchema.schemaResponse?.defaults;
  const schemaError = httpSchema.schemaResponse?.error ??
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
        if (opts?.replace) {
          window.history.replaceState({}, "", newSessionPath);
        } else {
          window.history.pushState({}, "", newSessionPath);
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
    [schema, simulator, resetInitValue, newSessionPath],
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
      const url = buildSessionUrl(sessionId);
      if (opts?.replace) {
        window.history.replaceState({}, "", url);
      } else {
        window.history.pushState({}, "", url);
      }
      adoptSessionFromPath(sessionId);
    },
    [adoptSessionFromPath, buildSessionUrl],
  );

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const initialSession = getSessionIdFromPath(undefined, sessionBasePath) ??
      getSessionIdFromPath();
    if (initialSession) {
      navigateToSession(initialSession, { replace: true });
      return;
    }
    startNewChat({ pushHistory: false });
  }, [navigateToSession, startNewChat, sessionBasePath]);

  useEffect(() => {
    const handler = () => {
      const sessionFromPath =
        getSessionIdFromPath(undefined, sessionBasePath) ??
          getSessionIdFromPath();
      if (sessionFromPath) {
        adoptSessionFromPath(sessionFromPath);
      } else {
        startNewChat({ pushHistory: false });
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [adoptSessionFromPath, startNewChat, sessionBasePath]);

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
  const sessionPermalink = sessionId ? buildSessionUrl(sessionId) : null;
  const sessionStatePath = typeof (runMeta as { sessionStatePath?: string })
      .sessionStatePath === "string"
    ? (runMeta as { sessionStatePath?: string }).sessionStatePath
    : typeof runMeta.sessionDir === "string"
    ? `${runMeta.sessionDir}/state.json`
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
          {sessionId && (
            <a
              href={buildCalibratePath(sessionId)}
              className="ghost-btn"
              title="Open Calibrate tab for this session"
            >
              Calibrate session
            </a>
          )}
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
            data-testid="debug-message-input"
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
            data-testid="debug-send"
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
            Session: {sessionPermalink
              ? (
                <a
                  href={sessionPermalink}
                  className="session-link"
                  title="Open session permalink"
                >
                  <code>{sessionId}</code>
                </a>
              )
              : <code>{sessionId}</code>}
          </div>
        )}
        {sessionStatePath && (
          <div className="session-meta session-path">
            State file: <code>{sessionStatePath}</code>
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
        onDelete={deleteSession}
        onClose={() => setSessionsOpen(false)}
      />
    </div>
  );
}

function CalibrateApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graders, setGraders] = useState<GraderDeckMeta[]>([]);
  const [sessions, setSessions] = useState<CalibrateSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [selectedGraderId, setSelectedGraderId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sessionDetail, setSessionDetail] = useState<
    SessionDetailResponse | null
  >(null);
  const [sessionDetailError, setSessionDetailError] = useState<string | null>(
    null,
  );
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [copiedStatePath, setCopiedStatePath] = useState(false);
  const initialCalibrateSessionRef = useRef<string | null>(
    getCalibrateSessionIdFromLocation(),
  );
  const initialCalibrateRef = useRef<CalibrateRef>(
    (() => {
      const ref = getCalibrateRefFromLocation();
      return ref ? parseGradingRef(ref) : {};
    })(),
  );

  const updateCalibratePath = useCallback((
    sessionId: string | null,
    opts?: { ref?: string | null },
  ) => {
    const targetPath = sessionId ? buildCalibratePath(sessionId) : "/calibrate";
    if (window.location.pathname === targetPath) return;
    const url = new URL(window.location.href);
    url.pathname = targetPath;
    if (!sessionId) {
      url.searchParams.delete("sessionId");
    }
    if (opts?.ref) {
      url.searchParams.set("ref", opts.ref);
    } else {
      url.searchParams.delete("ref");
    }
    window.history.replaceState({}, "", url.toString());
  }, []);

  const loadCalibrateData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/calibrate");
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as CalibrateResponse;
      const nextGraders = Array.isArray(data.graderDecks)
        ? data.graderDecks
        : [];
      const nextSessions = Array.isArray(data.sessions) ? data.sessions : [];
      setGraders(nextGraders);
      setSessions(nextSessions);
      setSelectedSessionId((prev) => {
        const requested = initialCalibrateSessionRef.current;
        if (
          requested && nextSessions.some((session) => session.id === requested)
        ) {
          initialCalibrateSessionRef.current = null;
          return requested;
        }
        if (prev && nextSessions.some((session) => session.id === prev)) {
          return prev;
        }
        return nextSessions[0]?.id ?? null;
      });
      setSelectedGraderId((prev) => {
        if (prev && nextGraders.some((grader) => grader.id === prev)) {
          return prev;
        }
        return nextGraders[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load calibration data",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCalibrateData();
  }, [loadCalibrateData]);

  useEffect(() => {
    const streamId = CALIBRATE_STREAM_ID;
    const streamUrl = buildDurableStreamUrl(
      streamId,
      getDurableStreamOffset(streamId),
    );
    const source = new EventSource(streamUrl);

    source.onmessage = (event) => {
      let envelope: { offset?: unknown; data?: unknown } | null = null;
      try {
        envelope = JSON.parse(event.data) as {
          offset?: unknown;
          data?: unknown;
        };
      } catch {
        return;
      }
      if (
        envelope &&
        typeof envelope.offset === "number" &&
        Number.isFinite(envelope.offset)
      ) {
        setDurableStreamOffset(streamId, envelope.offset + 1);
      }
      const msg = envelope?.data as CalibrateStreamMessage | undefined;
      if (!msg || msg.type !== "calibrateSession") return;
      setSessions((prev) => {
        const next = [...prev];
        const index = next.findIndex((sess) => sess.id === msg.session.id);
        if (index >= 0) {
          next[index] = msg.session;
          return next;
        }
        return [msg.session, ...next];
      });
    };

    return () => {
      source.close();
    };
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      updateCalibratePath(selectedSessionId);
    } else {
      updateCalibratePath(null);
    }
  }, [selectedSessionId, updateCalibratePath]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      setSessionDetailError(null);
      setSessionDetailLoading(false);
      return;
    }
    let active = true;
    const loadSessionDetail = async () => {
      try {
        setSessionDetailLoading(true);
        const res = await fetch(
          `/api/session?sessionId=${encodeURIComponent(selectedSessionId)}`,
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        const data = await res.json() as SessionDetailResponse;
        if (!active) return;
        setSessionDetail(data);
        setSessionDetailError(null);
      } catch (err) {
        if (!active) return;
        setSessionDetailError(
          err instanceof Error ? err.message : "Failed to load session details",
        );
        setSessionDetail(null);
      } finally {
        if (active) setSessionDetailLoading(false);
      }
    };
    loadSessionDetail();
    return () => {
      active = false;
    };
  }, [selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );
  const selectedGrader = useMemo(
    () => graders.find((grader) => grader.id === selectedGraderId) ?? null,
    [graders, selectedGraderId],
  );
  const sessionDeckDisplay = useMemo(() => {
    if (!selectedSession?.deck) return null;
    return toRelativePath(selectedSession.deck, repoRootPath) ??
      normalizeFsPath(selectedSession.deck);
  }, [selectedSession]);
  const sessionDirDisplay = useMemo(() => {
    if (!selectedSession?.sessionDir) return null;
    return toRelativePath(selectedSession.sessionDir, repoRootPath) ??
      normalizeFsPath(selectedSession.sessionDir);
  }, [selectedSession]);
  const sessionStateDisplay = useMemo(() => {
    if (!selectedSession?.statePath) return null;
    return toRelativePath(selectedSession.statePath, repoRootPath) ??
      normalizeFsPath(selectedSession.statePath);
  }, [selectedSession]);
  const sessionCreatedLabel = useMemo(() => {
    return selectedSession?.createdAt
      ? formatTimestamp(selectedSession.createdAt)
      : null;
  }, [selectedSession]);
  const sessionDebugHref = selectedSession
    ? `${SESSIONS_BASE_PATH}/${encodeURIComponent(selectedSession.id)}/debug`
    : null;
  const sessionRuns = useMemo(() => {
    if (!selectedSession?.gradingRuns) return [];
    return [...selectedSession.gradingRuns].reverse();
  }, [selectedSession]);
  const runSections = useMemo(() => {
    return sessionRuns.map((run) => {
      const items: Array<{
        key: string;
        label: string;
        status: CalibrationRun["status"];
        runAt?: string;
        error?: string;
        input?: unknown;
        result?: unknown;
        messageIndex?: number;
        runId: string;
        turnIndex?: number;
        turnNumber?: number;
        refId: string;
        pending?: boolean;
        referenceSample?: {
          score: number;
          reason: string;
          evidence?: string[];
        };
      }> = [];
      const result = run.result;
      if (
        result && typeof result === "object" && "mode" in result &&
        (result as { mode?: unknown }).mode === "turns" &&
        Array.isArray((result as { turns?: unknown }).turns)
      ) {
        const turns = (result as { turns?: unknown })
          .turns as Array<{
            index?: number;
            input?: unknown;
            result?: unknown;
            referenceSample?: {
              score: number;
              reason: string;
              evidence?: string[];
            };
          }>;
        const turnsDescending = [...turns].reverse();
        turnsDescending.forEach((turn, idx) => {
          const assistantTurnNumber = turns.length - idx;
          items.push({
            key: `${run.id}-${turn.index ?? idx}`,
            label: `Assistant turn ${assistantTurnNumber}`,
            status: run.status,
            runAt: run.runAt,
            error: run.error,
            input: turn.input,
            result: turn.result,
            messageIndex: turn.index ?? idx,
            runId: run.id,
            turnIndex: turn.index ?? idx,
            turnNumber: assistantTurnNumber,
            refId: `gradingRun:${run.id}#turn:${turn.index ?? idx}`,
            referenceSample: turn.referenceSample,
          });
        });
        if (run.status === "running") {
          const pendingTurnNumber = turns.length + 1;
          items.unshift({
            key: `${run.id}-turn-pending-${pendingTurnNumber}`,
            label: `Assistant turn ${pendingTurnNumber}`,
            status: "running",
            runAt: run.runAt,
            runId: run.id,
            turnNumber: pendingTurnNumber,
            refId: `gradingRun:${run.id}#turn:${pendingTurnNumber}`,
            pending: true,
          });
        }
        if (turns.length === 0 && run.status !== "running") {
          items.push({
            key: `${run.id}-empty`,
            label: "Turns",
            status: run.status,
            runAt: run.runAt,
            error: run.error,
            input: run.input,
            result: run.result,
            runId: run.id,
            refId: `gradingRun:${run.id}`,
            referenceSample: run.referenceSample,
          });
        }
      } else {
        if (run.status === "running") {
          items.push({
            key: `${run.id}-pending`,
            label: "Result",
            status: "running",
            runAt: run.runAt,
            runId: run.id,
            refId: `gradingRun:${run.id}`,
            pending: true,
          });
        } else {
          items.push({
            key: run.id,
            label: "Result",
            status: run.status,
            runAt: run.runAt,
            error: run.error,
            input: run.input,
            result: run.result,
            runId: run.id,
            refId: `gradingRun:${run.id}`,
            referenceSample: run.referenceSample,
          });
        }
      }
      return {
        run,
        label: run.graderLabel ?? run.graderId,
        items,
      };
    });
  }, [sessionRuns]);
  const runItems = useMemo(
    () => runSections.flatMap((section) => section.items),
    [runSections],
  );
  const runLabelById = useMemo(() => {
    const map = new Map<string, string>();
    runSections.forEach((section) => {
      map.set(section.run.id, section.label);
    });
    return map;
  }, [runSections]);
  const runItemByRefId = useMemo(() => {
    const map = new Map<string, (typeof runItems)[number]>();
    runItems.forEach((item) => {
      map.set(item.refId, item);
    });
    return map;
  }, [runItems]);
  const gradingFlags = useMemo(
    () => extractGradingFlags(sessionDetail?.meta),
    [sessionDetail?.meta],
  );
  const gradingFlagByRefId = useMemo(() => {
    const map = new Map<string, GradingFlag>();
    gradingFlags.forEach((flag) => {
      map.set(flag.refId, flag);
    });
    return map;
  }, [gradingFlags]);
  const flaggedRefSet = useMemo(() => {
    return new Set(gradingFlags.map((flag) => flag.refId));
  }, [gradingFlags]);
  const messageByRefId = useMemo(() => {
    const map = new Map<string, ModelMessage>();
    const refs = sessionDetail?.messageRefs ?? [];
    const messages = sessionDetail?.messages ?? [];
    refs.forEach((ref, idx) => {
      if (!ref?.id) return;
      const message = messages[idx];
      if (message) map.set(ref.id, message);
    });
    return map;
  }, [sessionDetail?.messageRefs, sessionDetail?.messages]);
  const feedbackItems = useMemo(() => {
    const feedback = sessionDetail?.feedback ?? [];
    const items = feedback.map((entry) => {
      const message = messageByRefId.get(entry.messageRefId);
      return {
        entry,
        message,
      };
    });
    return items.sort((a, b) => {
      const aKey = a.entry.createdAt ?? "";
      const bKey = b.entry.createdAt ?? "";
      return bKey.localeCompare(aKey);
    });
  }, [sessionDetail?.feedback, messageByRefId]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedResults, setExpandedResults] = useState<
    Record<string, boolean>
  >({});
  const [highlightedResult, setHighlightedResult] = useState<string | null>(
    null,
  );
  const [copiedRef, setCopiedRef] = useState<string | null>(null);
  const [flagReasonDrafts, setFlagReasonDrafts] = useState<
    Record<string, string>
  >({});
  const flagReasonTimeoutsRef = useRef<Record<string, number>>({});
  const [referenceDrafts, setReferenceDrafts] = useState<
    Record<
      string,
      { score: number; reason: string; evidenceText: string }
    >
  >({});
  const [showRawInputs, setShowRawInputs] = useState<Record<string, boolean>>(
    {},
  );

  useEffect(() => {
    const ref = initialCalibrateRef.current;
    if (!ref.runId) return;
    const match = runItems.find((item) =>
      item.runId === ref.runId &&
      (ref.turnIndex === undefined || item.turnIndex === ref.turnIndex)
    );
    if (!match) return;
    setExpandedResults((prev) => ({ ...prev, [match.key]: true }));
    setHighlightedResult(match.key);
    setExpandedRunId(ref.runId);
  }, [runItems]);
  useEffect(() => {
    const latestRunId = runSections[0]?.run.id ?? null;
    if (!latestRunId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId((prev) => (prev === latestRunId ? prev : latestRunId));
  }, [runSections]);

  useEffect(() => {
    return () => {
      const timers = flagReasonTimeoutsRef.current;
      Object.values(timers).forEach((handle) => clearTimeout(handle));
      flagReasonTimeoutsRef.current = {};
    };
  }, []);

  const toggleFlag = useCallback(async (item: {
    refId: string;
    runId: string;
    turnIndex?: number;
  }) => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch("/api/calibrate/flag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          refId: item.refId,
          runId: item.runId,
          turnIndex: item.turnIndex,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = await res.json() as {
        flags?: GradingFlag[];
      };
      if (!data.flags) return;
      setSessionDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          meta: {
            ...(prev.meta ?? {}),
            gradingFlags: data.flags,
          },
        };
      });
      setFlagReasonDrafts((prev) => {
        const next = { ...prev };
        const isNowFlagged = data.flags?.some((flag) =>
          flag.refId === item.refId
        );
        if (!isNowFlagged) {
          const timers = flagReasonTimeoutsRef.current;
          if (timers[item.refId]) {
            clearTimeout(timers[item.refId]);
            delete timers[item.refId];
          }
          delete next[item.refId];
          return next;
        }
        const flag = data.flags?.find((entry) => entry.refId === item.refId);
        if (flag?.reason) {
          next[item.refId] = flag.reason;
        } else {
          next[item.refId] = "";
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to flag grader");
    }
  }, [selectedSessionId]);

  const updateFlagReason = useCallback(
    async (refId: string, reason: string) => {
      if (!selectedSessionId) return;
      try {
        const res = await fetch("/api/calibrate/flag/reason", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: selectedSessionId,
            refId,
            reason,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        const data = await res.json() as { flags?: GradingFlag[] };
        if (!data.flags) return;
        setSessionDetail((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            meta: {
              ...(prev.meta ?? {}),
              gradingFlags: data.flags,
            },
          };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save reason");
      }
    },
    [selectedSessionId],
  );

  const scheduleFlagReasonSave = useCallback((
    refId: string,
    reason: string,
  ) => {
    const timers = flagReasonTimeoutsRef.current;
    if (timers[refId]) {
      clearTimeout(timers[refId]);
    }
    timers[refId] = window.setTimeout(() => {
      updateFlagReason(refId, reason);
      delete timers[refId];
    }, 650);
  }, [updateFlagReason]);

  const handleCopyStatePath = useCallback(() => {
    const target = selectedSession?.statePath ?? null;
    if (!target) return;
    navigator.clipboard?.writeText(target);
    setCopiedStatePath(true);
    window.setTimeout(() => setCopiedStatePath(false), 1200);
  }, [selectedSession?.statePath]);

  const runGrader = useCallback(async () => {
    if (!selectedSessionId || !selectedGraderId) return;
    try {
      setRunning(true);
      const res = await fetch("/api/calibrate/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          graderId: selectedGraderId,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = await res.json() as {
        session?: CalibrateSession;
      };
      if (data.session) {
        setSessions((prev) => {
          const index = prev.findIndex((sess) => sess.id === data.session!.id);
          if (index >= 0) {
            const next = [...prev];
            next[index] = data.session!;
            return next;
          }
          return [data.session!, ...prev];
        });
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run grader");
    } finally {
      setRunning(false);
    }
  }, [selectedSessionId, selectedGraderId]);

  const canRun = Boolean(selectedSessionId && selectedGraderId && !running);

  return (
    <div className="app-shell calibrate-shell">
      <header className="app-header">
        <div>
          <h1>Gambit Calibrate</h1>
          <div className="deck-path">
            Run deck-defined graders against saved sessions.
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={loadCalibrateData}
            disabled={loading}
          >
            Refresh data
          </button>
        </div>
      </header>
      <main className="calibrate-layout">
        <div className="chat-column calibrate-main-column">
          {error && <div className="error">{error}</div>}
          {loading && (
            <div className="editor-status">Loading calibration data…</div>
          )}
          {!loading && (
            <>
              {sessions.length === 0 && (
                <div className="placeholder">
                  No sessions found. Run the Test Bot to capture a session
                  before calibrating.
                </div>
              )}
              {graders.length === 0 && (
                <div className="placeholder">
                  No grader decks found. Add <code>[[graderDecks]]</code>{" "}
                  to your deck front matter to surface graders here.
                </div>
              )}
              {sessions.length > 0 && graders.length > 0 && (
                <>
                  <div
                    className="editor-panel calibrate-runner"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <strong>Run a grader</strong>
                    <label style={{ fontWeight: 600 }}>
                      Session
                      <select
                        data-testid="calibrate-session-select"
                        value={selectedSessionId ?? ""}
                        onChange={(e) =>
                          setSelectedSessionId(
                            e.target.value.length ? e.target.value : null,
                          )}
                        style={{
                          width: "100%",
                          borderRadius: 10,
                          border: "1px solid #cbd5e1",
                          padding: 8,
                          fontFamily: "inherit",
                          marginTop: 4,
                        }}
                      >
                        {sessions.map((session) => (
                          <option key={session.id} value={session.id}>
                            {session.testBotName ??
                              session.deckSlug ??
                              session.deck ??
                              session.id}
                            {session.createdAt
                              ? ` · ${formatTimestamp(session.createdAt)}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontWeight: 600 }}>
                      Grader
                      <select
                        data-testid="calibrate-grader-select"
                        value={selectedGraderId ?? ""}
                        onChange={(e) =>
                          setSelectedGraderId(
                            e.target.value.length ? e.target.value : null,
                          )}
                        style={{
                          width: "100%",
                          borderRadius: 10,
                          border: "1px solid #cbd5e1",
                          padding: 8,
                          fontFamily: "inherit",
                          marginTop: 4,
                        }}
                      >
                        {graders.map((grader) => (
                          <option key={grader.id} value={grader.id}>
                            {grader.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedGrader?.description && (
                      <div className="placeholder">
                        {selectedGrader.description}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="primary"
                        onClick={runGrader}
                        disabled={!canRun}
                      >
                        {running ? "Running…" : "Run grader"}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={loadCalibrateData}
                        disabled={loading}
                      >
                        Refresh sessions
                      </button>
                    </div>
                  </div>
                  <div
                    className="editor-panel calibrate-results"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <strong>
                      Recent results {selectedSession &&
                        `(Session ${selectedSession.id})`}
                    </strong>
                    {runItems.length === 0 && (
                      <div className="placeholder">
                        No grader runs for this session yet.
                      </div>
                    )}
                    {runSections.map((section) => {
                      const isExpanded = expandedRunId === section.run.id;
                      const runModeTurns = isTurnsResult(section.run.result);
                      const totalTurns = runModeTurns
                        ? extractTotalTurnsFromResult(section.run.result) ??
                          extractTotalTurns(section.run.input) ??
                          extractTotalTurns(
                            section.items.find((item) => item.input)?.input,
                          )
                        : undefined;
                      const isTurnRun = Boolean(
                        runModeTurns ||
                          section.items.some((item) =>
                            item.turnNumber !== undefined || item.pending
                          ),
                      );
                      const turnBadges = isTurnRun
                        ? Array.from({
                          length: totalTurns ??
                            section.items.filter((item) =>
                              item.turnNumber !== undefined || item.pending
                            ).length,
                        }).map((_, idx) => {
                          const turnLabel = idx + 1;
                          const item = section.items.find((entry) =>
                            entry.turnNumber === turnLabel || (
                              entry.pending &&
                              entry.turnNumber === turnLabel
                            )
                          );
                          if (item?.pending) {
                            return (
                              <span
                                key={`${section.run.id}-turn-${turnLabel}`}
                                className="calibrate-run-turn calibrate-run-turn--pending"
                                title={`Turn ${turnLabel}: running`}
                              >
                                <span
                                  className="calibrate-spinner calibrate-spinner--tiny"
                                  role="status"
                                  aria-label="Grading"
                                />
                              </span>
                            );
                          }
                          if (item) {
                            const graded = extractScoreAndReason(item.result);
                            const reference = extractScoreAndReasonFromSample(
                              item.referenceSample,
                            );
                            const displayScore = reference.score ??
                              graded.score;
                            const scoreClass = getScoreClass(displayScore);
                            return (
                              <span
                                key={`${section.run.id}-turn-${turnLabel}`}
                                className={`calibrate-run-turn ${scoreClass}`}
                                title={`Turn ${turnLabel}: ${
                                  displayScore ?? "—"
                                }`}
                              />
                            );
                          }
                          return (
                            <span
                              key={`${section.run.id}-turn-${turnLabel}`}
                              className="calibrate-run-turn calibrate-run-turn--empty"
                              title={`Turn ${turnLabel}: pending`}
                            />
                          );
                        })
                        : (() => {
                          const item = section.items[0];
                          if (section.run.status === "running") {
                            return [
                              <span
                                key={`${section.run.id}-pending`}
                                className="calibrate-run-turn calibrate-run-turn--pending"
                                title="Running"
                              >
                                <span
                                  className="calibrate-spinner calibrate-spinner--tiny"
                                  role="status"
                                  aria-label="Grading"
                                />
                              </span>,
                            ];
                          }
                          if (item) {
                            const graded = extractScoreAndReason(item.result);
                            const reference = extractScoreAndReasonFromSample(
                              item.referenceSample,
                            );
                            const displayScore = reference.score ??
                              graded.score;
                            const scoreClass = getScoreClass(displayScore);
                            return [
                              <span
                                key={`${section.run.id}-result`}
                                className={`calibrate-run-turn ${scoreClass}`}
                                title={`Result: ${displayScore ?? "—"}`}
                              />,
                            ];
                          }
                          return [];
                        })();
                      return (
                        <div
                          key={section.run.id}
                          className="calibrate-run-card"
                        >
                          <div className="calibrate-run-header">
                            <div>
                              <div className="calibrate-run-title-row">
                                <div className="calibrate-run-title">
                                  {section.label}
                                </div>
                                <div className="calibrate-run-turns">
                                  {turnBadges}
                                </div>
                              </div>
                              <div className="calibrate-run-subtitle">
                                {section.run.status}
                                {section.run.runAt
                                  ? ` · ${
                                    formatTimestampShort(section.run.runAt)
                                  }`
                                  : ""}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="ghost-btn calibrate-run-toggle"
                              onClick={() =>
                                setExpandedRunId((prev) =>
                                  prev === section.run.id
                                    ? null
                                    : section.run.id
                                )}
                            >
                              {isExpanded ? "Collapse" : "Expand"}
                            </button>
                          </div>
                          {isExpanded && (
                            <div className="calibrate-run-body">
                              {section.items.map((item) => {
                                const graded = extractScoreAndReason(
                                  item.result,
                                );
                                const reference =
                                  extractScoreAndReasonFromSample(
                                    item.referenceSample,
                                  );
                                const displayScore = reference.score ??
                                  graded.score;
                                const displayReason = reference.reason ??
                                  graded.reason;
                                const turnContext = extractTurnContext(
                                  item.input,
                                );
                                const conversationContext =
                                  extractConversationContext(item.input);
                                const isPending = Boolean(item.pending);
                                const delta = reference.score !== undefined &&
                                    graded.score !== undefined
                                  ? reference.score - graded.score
                                  : undefined;
                                const polarityFlip = graded.score !==
                                    undefined &&
                                  reference.score !== undefined &&
                                  graded.score !== 0 &&
                                  reference.score !== 0 &&
                                  (graded.score > 0) !==
                                    (reference.score > 0);
                                const scoreClass = getScoreClass(displayScore);
                                const isOpen = !isPending && Boolean(
                                  expandedResults[item.key],
                                );
                                const draft = referenceDrafts[item.key];
                                const isFlagged = flaggedRefSet.has(item.refId);
                                return (
                                  <div
                                    key={item.key}
                                    className={`calibrate-run-section${
                                      highlightedResult === item.key
                                        ? " trace-row-highlight"
                                        : ""
                                    }`}
                                  >
                                    <div className="calibrate-result-header">
                                      <div className="calibrate-result-main">
                                        <div
                                          className={`calibrate-score-badge ${scoreClass}${
                                            isPending
                                              ? " calibrate-score-badge--pending"
                                              : ""
                                          }`}
                                        >
                                          {isPending
                                            ? (
                                              <span
                                                className="calibrate-spinner"
                                                role="status"
                                                aria-label="Grading"
                                              />
                                            )
                                            : displayScore !== undefined
                                            ? displayScore
                                            : "—"}
                                        </div>
                                        <div className="calibrate-result-meta">
                                          <div className="calibrate-result-title">
                                            {item.label}
                                          </div>
                                          <div className="calibrate-result-subtitle">
                                            {item.status}
                                            {item.runAt
                                              ? ` · ${
                                                formatTimestampShort(item.runAt)
                                              }`
                                              : ""}
                                            {reference.score !== undefined && (
                                              <span className="calibrate-score-chip">
                                                ref
                                              </span>
                                            )}
                                            {delta !== undefined && (
                                              <span className="calibrate-delta-chip">
                                                {delta >= 0
                                                  ? `+${delta}`
                                                  : `${delta}`}
                                              </span>
                                            )}
                                            {polarityFlip && (
                                              <span className="calibrate-alert-chip">
                                                !
                                              </span>
                                            )}
                                          </div>
                                          {displayReason && !isPending && (
                                            <div className="calibrate-result-reason">
                                              {displayReason}
                                            </div>
                                          )}
                                          {reference.score !== undefined &&
                                            graded.score !== undefined && (
                                            <div className="calibrate-result-secondary">
                                              Graded score: {graded.score}
                                            </div>
                                          )}
                                          {isPending && (
                                            <div className="calibrate-result-secondary">
                                              Grading…
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      {!isPending && (
                                        <div className="calibrate-result-actions">
                                          <button
                                            type="button"
                                            className={classNames(
                                              "ghost-btn",
                                              "calibrate-flag-btn",
                                              isFlagged && "active",
                                            )}
                                            onClick={() =>
                                              toggleFlag({
                                                refId: item.refId,
                                                runId: item.runId,
                                                turnIndex: item.turnIndex,
                                              })}
                                          >
                                            {isFlagged ? "Flagged" : "Flag"}
                                          </button>
                                          <button
                                            type="button"
                                            className="ghost-btn calibrate-ref-copy"
                                            onClick={() => {
                                              const basePath =
                                                selectedSession?.statePath ??
                                                  selectedSession?.sessionDir ??
                                                  "";
                                              const refPath = basePath
                                                ? `${basePath}#${item.refId}`
                                                : item.refId;
                                              navigator.clipboard?.writeText(
                                                refPath,
                                              );
                                              setCopiedRef(item.key);
                                              window.setTimeout(
                                                () =>
                                                  setCopiedRef((prev) =>
                                                    prev === item.key
                                                      ? null
                                                      : prev
                                                  ),
                                                1200,
                                              );
                                            }}
                                          >
                                            {copiedRef === item.key
                                              ? "Copied"
                                              : "Copy ref"}
                                          </button>
                                          <button
                                            type="button"
                                            className="ghost-btn calibrate-toggle"
                                            onClick={() =>
                                              setExpandedResults((prev) => {
                                                const nextOpen = !isOpen;
                                                if (
                                                  nextOpen &&
                                                  !referenceDrafts[item.key]
                                                ) {
                                                  const seedScore =
                                                    reference.score ?? NaN;
                                                  const seedReason =
                                                    reference.reason ?? "";
                                                  const seedEvidence =
                                                    item.referenceSample
                                                        ?.evidence
                                                      ? item.referenceSample
                                                        .evidence.join("\n")
                                                      : "";
                                                  setReferenceDrafts((
                                                    drafts,
                                                  ) => ({
                                                    ...drafts,
                                                    [item.key]: {
                                                      score: seedScore,
                                                      reason: seedReason,
                                                      evidenceText:
                                                        seedEvidence,
                                                    },
                                                  }));
                                                }
                                                return {
                                                  ...prev,
                                                  [item.key]: nextOpen,
                                                };
                                              })}
                                          >
                                            {isOpen
                                              ? "Hide details"
                                              : "Show details"}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    {isFlagged && !isPending && (
                                      <div className="calibrate-flag-reason">
                                        <label>
                                          Reason
                                          <textarea
                                            value={flagReasonDrafts[
                                              item.refId
                                            ] ??
                                              gradingFlagByRefId.get(item.refId)
                                                ?.reason ??
                                              ""}
                                            placeholder="Why is this flagged?"
                                            onChange={(e) => {
                                              const nextReason = e.target.value;
                                              setFlagReasonDrafts((prev) => ({
                                                ...prev,
                                                [item.refId]: nextReason,
                                              }));
                                              scheduleFlagReasonSave(
                                                item.refId,
                                                nextReason,
                                              );
                                            }}
                                            onBlur={(e) => {
                                              scheduleFlagReasonSave(
                                                item.refId,
                                                e.target.value,
                                              );
                                            }}
                                          />
                                        </label>
                                      </div>
                                    )}
                                    {item.error && (
                                      <div className="error">{item.error}</div>
                                    )}
                                    {item.turnIndex !== undefined &&
                                      !isPending && (
                                      <div className="calibrate-context calibrate-context-compact">
                                        {turnContext.priorUser && (
                                          <div className="calibrate-context-row">
                                            <div className="calibrate-context-label">
                                              Prior user
                                            </div>
                                            <div className="calibrate-context-bubble calibrate-context-user">
                                              {turnContext.priorUser}
                                            </div>
                                          </div>
                                        )}
                                        {turnContext.gradedAssistant && (
                                          <div className="calibrate-context-row">
                                            <div className="calibrate-context-label">
                                              Graded assistant
                                            </div>
                                            <div className="calibrate-context-bubble calibrate-context-assistant">
                                              {turnContext.gradedAssistant}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {isOpen && (
                                      <div className="calibrate-result-details">
                                        <div>
                                          <div className="calibrate-section-title">
                                            Graded sample
                                          </div>
                                          <pre className="trace-json">
                                          {JSON.stringify(
                                            item.result ?? null,
                                            null,
                                            2,
                                          )}
                                          </pre>
                                        </div>
                                        <div>
                                          <div className="calibrate-section-title">
                                            Input
                                          </div>
                                          {typeof item.messageIndex ===
                                              "number" && (
                                            <div className="calibrate-result-meta-line">
                                              Message index: {item.messageIndex}
                                            </div>
                                          )}
                                          {item.turnIndex !== undefined
                                            ? (
                                              <div className="calibrate-context">
                                                {turnContext.priorUser && (
                                                  <div className="calibrate-context-row">
                                                    <div className="calibrate-context-label">
                                                      Prior user
                                                    </div>
                                                    <div className="calibrate-context-bubble calibrate-context-user">
                                                      {turnContext.priorUser}
                                                    </div>
                                                  </div>
                                                )}
                                                {turnContext.gradedAssistant &&
                                                  (
                                                    <div className="calibrate-context-row">
                                                      <div className="calibrate-context-label">
                                                        Graded assistant
                                                      </div>
                                                      <div className="calibrate-context-bubble calibrate-context-assistant">
                                                        {turnContext
                                                          .gradedAssistant}
                                                      </div>
                                                    </div>
                                                  )}
                                                <button
                                                  type="button"
                                                  className="ghost-btn calibrate-toggle"
                                                  onClick={() =>
                                                    setShowRawInputs((
                                                      prev,
                                                    ) => ({
                                                      ...prev,
                                                      [item.key]:
                                                        !prev[item.key],
                                                    }))}
                                                >
                                                  {showRawInputs[item.key]
                                                    ? "Hide raw input"
                                                    : "Show raw input"}
                                                </button>
                                                {showRawInputs[item.key] && (
                                                  <pre className="trace-json">
                                                  {JSON.stringify(
                                                    item.input ?? null,
                                                    null,
                                                    2,
                                                  )}
                                                  </pre>
                                                )}
                                              </div>
                                            )
                                            : (
                                              <div className="calibrate-context">
                                                {conversationContext
                                                  .latestUser && (
                                                  <div className="calibrate-context-row">
                                                    <div className="calibrate-context-label">
                                                      Latest user
                                                    </div>
                                                    <div className="calibrate-context-bubble calibrate-context-user">
                                                      {conversationContext
                                                        .latestUser}
                                                    </div>
                                                  </div>
                                                )}
                                                {conversationContext
                                                  .latestAssistant && (
                                                  <div className="calibrate-context-row">
                                                    <div className="calibrate-context-label">
                                                      Latest assistant
                                                    </div>
                                                    <div className="calibrate-context-bubble calibrate-context-assistant">
                                                      {conversationContext
                                                        .latestAssistant}
                                                    </div>
                                                  </div>
                                                )}
                                                <button
                                                  type="button"
                                                  className="ghost-btn calibrate-toggle"
                                                  onClick={() =>
                                                    setShowRawInputs((
                                                      prev,
                                                    ) => ({
                                                      ...prev,
                                                      [item.key]:
                                                        !prev[item.key],
                                                    }))}
                                                >
                                                  {showRawInputs[item.key]
                                                    ? "Hide raw input"
                                                    : "Show raw input"}
                                                </button>
                                                {showRawInputs[item.key] && (
                                                  <pre className="trace-json">
                                                  {JSON.stringify(
                                                    item.input ?? null,
                                                    null,
                                                    2,
                                                  )}
                                                  </pre>
                                                )}
                                              </div>
                                            )}
                                        </div>
                                        <div>
                                          <div className="calibrate-section-title">
                                            Reference sample
                                          </div>
                                          {item.referenceSample
                                            ? (
                                              <pre className="trace-json">
                                              {JSON.stringify(
                                                item.referenceSample,
                                                null,
                                                2,
                                              )}
                                              </pre>
                                            )
                                            : (
                                              <div className="placeholder">
                                                No reference sample yet.
                                              </div>
                                            )}
                                          {draft && (
                                            <div className="calibrate-reference-form">
                                              <div className="calibrate-score-buttons">
                                                {SCORE_VALUES.map((value) => (
                                                  <button
                                                    key={value}
                                                    type="button"
                                                    className={Number.isNaN(
                                                        draft.score,
                                                      )
                                                      ? "score-btn"
                                                      : value === draft.score
                                                      ? "score-btn score-btn-active"
                                                      : "score-btn"}
                                                    onClick={() =>
                                                      setReferenceDrafts(
                                                        (prev) => ({
                                                          ...prev,
                                                          [item.key]: {
                                                            ...draft,
                                                            score: value,
                                                          },
                                                        }),
                                                      )}
                                                  >
                                                    {value}
                                                  </button>
                                                ))}
                                              </div>
                                              <label>
                                                Reason
                                                <textarea
                                                  value={draft.reason}
                                                  onChange={(e) =>
                                                    setReferenceDrafts(
                                                      (prev) => ({
                                                        ...prev,
                                                        [item.key]: {
                                                          ...draft,
                                                          reason: e.target
                                                            .value,
                                                        },
                                                      }),
                                                    )}
                                                />
                                              </label>
                                              <label>
                                                Evidence (one per line)
                                                <textarea
                                                  value={draft.evidenceText}
                                                  onChange={(e) =>
                                                    setReferenceDrafts(
                                                      (prev) => ({
                                                        ...prev,
                                                        [item.key]: {
                                                          ...draft,
                                                          evidenceText: e
                                                            .target.value,
                                                        },
                                                      }),
                                                    )}
                                                />
                                              </label>
                                              <div className="calibrate-reference-actions">
                                                <button
                                                  type="button"
                                                  className="ghost-btn"
                                                  onClick={async () => {
                                                    if (!selectedSessionId) {
                                                      return;
                                                    }
                                                    if (
                                                      graded.score === undefined
                                                    ) {
                                                      setError(
                                                        "No graded score available to agree with.",
                                                      );
                                                      return;
                                                    }
                                                    const payload = {
                                                      sessionId:
                                                        selectedSessionId,
                                                      runId: item.runId,
                                                      turnIndex: item.turnIndex,
                                                      referenceSample: {
                                                        score: graded.score,
                                                        reason: graded.reason ??
                                                          "",
                                                      },
                                                    };
                                                    setReferenceDrafts(
                                                      (prev) => ({
                                                        ...prev,
                                                        [item.key]: {
                                                          ...draft,
                                                          score: graded.score!,
                                                          reason:
                                                            graded.reason ??
                                                              "",
                                                          evidenceText: "",
                                                        },
                                                      }),
                                                    );
                                                    const res = await fetch(
                                                      "/api/grading/reference",
                                                      {
                                                        method: "POST",
                                                        headers: {
                                                          "content-type":
                                                            "application/json",
                                                        },
                                                        body: JSON.stringify(
                                                          payload,
                                                        ),
                                                      },
                                                    );
                                                    if (!res.ok) {
                                                      const message = await res
                                                        .text();
                                                      setError(
                                                        message ||
                                                          "Failed to save reference",
                                                      );
                                                    }
                                                  }}
                                                >
                                                  Agree with graded
                                                </button>
                                                <button
                                                  type="button"
                                                  className="primary"
                                                  onClick={async () => {
                                                    if (!selectedSessionId) {
                                                      return;
                                                    }
                                                    const evidence = draft
                                                      .evidenceText
                                                      .split("\n")
                                                      .map((line) =>
                                                        line.trim()
                                                      )
                                                      .filter(Boolean);
                                                    if (
                                                      Number.isNaN(draft.score)
                                                    ) {
                                                      setError(
                                                        "Select a reference score.",
                                                      );
                                                      return;
                                                    }
                                                    const payload = {
                                                      sessionId:
                                                        selectedSessionId,
                                                      runId: item.runId,
                                                      turnIndex: item.turnIndex,
                                                      referenceSample: {
                                                        score: draft.score,
                                                        reason: draft.reason,
                                                        evidence:
                                                          evidence.length
                                                            ? evidence
                                                            : undefined,
                                                      },
                                                    };
                                                    const res = await fetch(
                                                      "/api/grading/reference",
                                                      {
                                                        method: "POST",
                                                        headers: {
                                                          "content-type":
                                                            "application/json",
                                                        },
                                                        body: JSON.stringify(
                                                          payload,
                                                        ),
                                                      },
                                                    );
                                                    if (!res.ok) {
                                                      const message = await res
                                                        .text();
                                                      setError(
                                                        message ||
                                                          "Failed to save reference",
                                                      );
                                                    }
                                                  }}
                                                >
                                                  Save reference
                                                </button>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <aside className="calibrate-drawer">
          <h3>Deck & session</h3>
          <div className="drawer-section">
            <strong>Ratings & flags</strong>
            {selectedSession?.statePath && (
              <>
                <button
                  type="button"
                  className="primary"
                  onClick={handleCopyStatePath}
                >
                  {copiedStatePath ? "Copied" : "Copy state path"}
                </button>
                <p className="calibrate-button-meta">
                  Paste this in your coding assistant to debug the agent.
                </p>
              </>
            )}
            {sessionDetailLoading && (
              <div className="placeholder">Loading ratings and flags…</div>
            )}
            {sessionDetailError && (
              <div className="error">{sessionDetailError}</div>
            )}
            {!sessionDetailLoading &&
              !sessionDetailError &&
              feedbackItems.length === 0 &&
              gradingFlags.length === 0 && (
              <div className="placeholder">
                No ratings or flags yet.
              </div>
            )}
            {feedbackItems.length > 0 && (
              <div className="calibrate-summary-list">
                {feedbackItems.map(({ entry, message }) => (
                  <div
                    key={`${entry.id}-${entry.messageRefId}`}
                    className="calibrate-summary-card"
                  >
                    <div className="calibrate-summary-title">
                      Rating {entry.score}
                    </div>
                    {entry.reason && (
                      <div className="calibrate-summary-reason ellipsis">
                        {entry.reason}
                      </div>
                    )}
                    {message?.content && (
                      <div className="calibrate-summary-meta ellipsis">
                        {formatSnippet(message.content)}
                      </div>
                    )}
                    {entry.createdAt && (
                      <div className="calibrate-summary-meta ellipsis">
                        {formatTimestampShort(entry.createdAt)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {gradingFlags.length > 0 && (
              <div className="calibrate-summary-list">
                {gradingFlags.map((flag) => {
                  const runLabel = flag.runId
                    ? runLabelById.get(flag.runId)
                    : undefined;
                  const flaggedItem = runItemByRefId.get(flag.refId);
                  const turnLabel = flaggedItem?.turnNumber
                    ? `Turn ${flaggedItem.turnNumber}`
                    : undefined;
                  return (
                    <div
                      key={flag.id}
                      className="calibrate-summary-card calibrate-flag-card"
                    >
                      <div className="calibrate-summary-title">
                        Flagged grader
                      </div>
                      {runLabel && (
                        <div className="calibrate-summary-meta ellipsis">
                          {runLabel}
                        </div>
                      )}
                      {turnLabel && (
                        <div className="calibrate-summary-meta ellipsis">
                          {turnLabel}
                        </div>
                      )}
                      {!runLabel && (
                        <div className="calibrate-summary-meta ellipsis">
                          {flag.refId}
                        </div>
                      )}
                      {flag.reason && (
                        <div className="calibrate-summary-reason ellipsis">
                          {flag.reason}
                        </div>
                      )}
                      {flag.createdAt && (
                        <div className="calibrate-summary-meta ellipsis ">
                          {formatTimestampShort(flag.createdAt)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="drawer-section">
            <strong>Deck reference</strong>
            <CopyBadge
              label="Deck path"
              displayValue={deckDisplayPath}
              copyValue={normalizedDeckPath}
            />
          </div>
          <div className="drawer-section">
            <strong>Selected session</strong>
            {selectedSession
              ? (
                <>
                  <CopyBadge
                    label="Session ID"
                    displayValue={selectedSession.id}
                  />
                  {sessionDeckDisplay && (
                    <CopyBadge
                      label="Session deck"
                      displayValue={sessionDeckDisplay}
                      copyValue={selectedSession.deck ?? sessionDeckDisplay}
                    />
                  )}
                  {sessionDirDisplay && (
                    <CopyBadge
                      label="Session folder"
                      displayValue={sessionDirDisplay}
                      copyValue={selectedSession.sessionDir ??
                        sessionDirDisplay}
                    />
                  )}
                  {sessionStateDisplay && (
                    <CopyBadge
                      label="State file"
                      displayValue={sessionStateDisplay}
                      copyValue={selectedSession.statePath ??
                        sessionStateDisplay}
                    />
                  )}
                  {sessionCreatedLabel && (
                    <div className="drawer-meta">
                      Created {sessionCreatedLabel}
                    </div>
                  )}
                  {sessionDebugHref && (
                    <a
                      className="ghost-btn"
                      href={sessionDebugHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open session debug
                    </a>
                  )}
                </>
              )
              : (
                <div className="placeholder">
                  Select a session to view file paths and metadata.
                </div>
              )}
          </div>
        </aside>
      </main>
    </div>
  );
}

function TestBotApp(props: {
  onNavigateToSession: (sessionId: string) => void;
  onReplaceTestBotSession: (sessionId: string) => void;
  onResetTestBotSession: () => void;
  activeSessionId: string | null;
}) {
  const {
    onNavigateToSession,
    onReplaceTestBotSession,
    onResetTestBotSession,
    activeSessionId,
  } = props;
  const deckStorageKey = "gambit:test-bot:selected-deck";
  const [testDecks, setTestDecks] = useState<TestDeckMeta[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [botLabel, setBotLabel] = useState<string | null>(null);
  const [botDescription, setBotDescription] = useState<string | null>(null);
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
  const [botInputDefaults, setBotInputDefaults] = useState<unknown>(undefined);
  const [initialUserMessage, setInitialUserMessage] = useState("");
  const [run, setRun] = useState<TestBotRun>({
    status: "idle",
    messages: [],
    traces: [],
    toolInserts: [],
  });
  const runRef = useRef<TestBotRun>({
    status: "idle",
    messages: [],
    traces: [],
    toolInserts: [],
  });
  const lastRunMessageCountRef = useRef(0);
  const [toolCallsOpen, setToolCallsOpen] = useState<
    Record<number, boolean>
  >({});
  const [latencyByTurn, setLatencyByTurn] = useState<
    Record<number, number>
  >({});
  const lastUserEndByTurnRef = useRef<Record<number, number>>({});
  const firstAssistantTokenByTurnRef = useRef<Record<number, boolean>>({});

  useEffect(() => {
    lastRunMessageCountRef.current = 0;
    setToolCallsOpen({});
    setLatencyByTurn({});
    lastUserEndByTurnRef.current = {};
    firstAssistantTokenByTurnRef.current = {};
  }, [run.id]);
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
  const pollRef = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef<string | undefined>(undefined);

  const loadTestBot = useCallback(async (opts?: { deckId?: string }) => {
    let storedDeckId: string | null = null;
    try {
      storedDeckId = localStorage.getItem(deckStorageKey);
    } catch {
      storedDeckId = null;
    }
    const requestedDeckId = opts?.deckId ?? storedDeckId ?? undefined;
    const fetchTestBotConfig = async (deckId?: string) => {
      const params = new URLSearchParams();
      if (deckId) params.set("deckPath", deckId);
      const query = params.toString() ? `?${params.toString()}` : "";
      return fetch(`/api/test-bot${query}`);
    };
    try {
      let res = await fetchTestBotConfig(requestedDeckId);
      if (!res.ok && res.status === 400 && requestedDeckId) {
        try {
          localStorage.removeItem(deckStorageKey);
        } catch {
          // ignore storage failures
        }
        res = await fetchTestBotConfig();
      }
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as TestBotConfigResponse;
      const decks = Array.isArray(data.testDecks) ? data.testDecks : [];
      setTestDecks(decks);
      setBotLabel(typeof data.botLabel === "string" ? data.botLabel : null);
      setBotDescription(
        typeof data.botDescription === "string" ? data.botDescription : null,
      );
      setBotPath(typeof data.botPath === "string" ? data.botPath : null);
      const nextDeckId = (() => {
        if (!decks.length) return null;
        const requested = data.selectedDeckId ?? requestedDeckId ?? null;
        if (requested && decks.some((deck) => deck.id === requested)) {
          return requested;
        }
        return decks[0]?.id ?? null;
      })();
      setSelectedDeckId(nextDeckId ?? null);
      setBotInputSchema(data.inputSchema ?? null);
      setBotInputSchemaError(
        typeof data.inputSchemaError === "string"
          ? data.inputSchemaError
          : null,
      );
      setBotInputDirty(false);
      setBotInputJsonErrors({});
      setBotInputDefaults(data.defaults?.input);
      setBotInputValue(data.defaults?.input);
    } catch (err) {
      console.error(err);
    }
  }, [deckStorageKey]);

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
    if (!run.sessionId) return;
    onReplaceTestBotSession(run.sessionId);
  }, [onReplaceTestBotSession, run.sessionId]);

  useEffect(() => {
    if (!selectedDeckId) return;
    try {
      localStorage.setItem(deckStorageKey, selectedDeckId);
    } catch {
      // ignore storage failures
    }
  }, [deckStorageKey, selectedDeckId]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    const streamId = TEST_BOT_STREAM_ID;
    const streamUrl = buildDurableStreamUrl(
      streamId,
      getDurableStreamOffset(streamId),
    );
    const source = new EventSource(streamUrl);

    source.onopen = () => {
      console.info("[test-bot] stream open", streamUrl);
    };

    source.onmessage = (event) => {
      let envelope: { offset?: unknown; data?: unknown } | null = null;
      try {
        envelope = JSON.parse(event.data) as {
          offset?: unknown;
          data?: unknown;
        };
      } catch {
        return;
      }
      if (
        envelope &&
        typeof envelope.offset === "number" &&
        Number.isFinite(envelope.offset)
      ) {
        setDurableStreamOffset(streamId, envelope.offset + 1);
      }
      const msg = envelope?.data as TestBotSocketMessage | undefined;
      if (!msg) return;
      const activeRunId = runIdRef.current;
      if (msg.type === "testBotStatus" && msg.run) {
        if (activeRunId && msg.run.id === activeRunId) {
          setRun({
            ...msg.run,
            messages: msg.run.messages ?? [],
            traces: msg.run.traces ?? [],
            toolInserts: msg.run.toolInserts ?? [],
          });
        }
        return;
      }
      if (msg.type === "testBotStream") {
        if (!msg.runId || (activeRunId && msg.runId !== activeRunId)) return;
        const streamRunId = msg.runId;
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        if (msg.role === "assistant") {
          if (!firstAssistantTokenByTurnRef.current[turn]) {
            firstAssistantTokenByTurnRef.current[turn] = true;
            const userEnd = lastUserEndByTurnRef.current[turn];
            if (typeof userEnd === "number" && typeof msg.ts === "number") {
              const delta = msg.ts - userEnd;
              setLatencyByTurn((prev) => ({
                ...prev,
                [turn]: delta,
              }));
            }
          }
        }
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
          lastUserEndByTurnRef.current[turn] = typeof msg.ts === "number"
            ? msg.ts
            : Date.now();
          delete firstAssistantTokenByTurnRef.current[turn];
        }
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

    source.onerror = (err) => {
      console.warn("[test-bot] stream error", err);
    };

    return () => {
      console.info("[test-bot] stream cleanup");
      source.close();
    };
  }, []);

  const refreshStatus = useCallback(async (
    opts?: { runId?: string; sessionId?: string },
  ) => {
    try {
      const runId = opts?.runId ?? run.id;
      const sessionId = opts?.sessionId;
      const params = new URLSearchParams();
      if (runId) params.set("runId", runId);
      if (sessionId) params.set("sessionId", sessionId);
      const deckParam = testDecks.length
        ? (selectedDeckId || testDecks[0]?.id || "")
        : "";
      if (deckParam) params.set("deckPath", deckParam);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/test-bot/status${query}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as TestBotConfigResponse & {
        run?: TestBotRun;
      };
      const nextRun = data.run ?? { status: "idle", messages: [] };
      setRun({
        ...nextRun,
        messages: nextRun.messages ?? [],
        traces: nextRun.traces ?? [],
        toolInserts: nextRun.toolInserts ?? [],
      });
    } catch (err) {
      console.error(err);
    }
  }, [run.id, selectedDeckId, testDecks]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!activeSessionId) return;
    refreshStatus({ sessionId: activeSessionId });
  }, [activeSessionId, refreshStatus]);

  useEffect(() => {
    if (!deckInputSchema) return;
    if (deckInitDirty) return;
    const nextInit = deckSchemaDefaults !== undefined
      ? cloneValue(deckSchemaDefaults)
      : deriveInitialFromSchema(deckInputSchema);
    setDeckInitValue(nextInit);
  }, [deckInputSchema, deckSchemaDefaults, deckInitDirty]);

  useEffect(() => {
    if (!botInputSchema) return;
    if (botInputDirty) return;
    const nextBotInput = botInputDefaults !== undefined
      ? cloneValue(botInputDefaults)
      : deriveInitialFromSchema(botInputSchema);
    setBotInputValue(nextBotInput);
  }, [botInputSchema, botInputDirty, botInputDefaults]);

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

  const toolCallSummaries = useMemo(
    () => summarizeToolCalls(run.traces ?? []),
    [run.traces],
  );

  const toolBuckets = useMemo(() => {
    const deriveInsertsFromTraces = (
      traces: TraceEvent[],
      messageCount: number,
    ) => {
      const inserts: Array<{
        actionCallId?: string;
        parentActionCallId?: string;
        name?: string;
        index: number;
      }> = [];
      let messageIndex = 0;
      for (const trace of traces) {
        if (!trace || typeof trace !== "object") continue;
        const traceRecord = trace as Record<string, unknown>;
        const type = typeof traceRecord.type === "string"
          ? traceRecord.type
          : "";
        if (type === "message.user") {
          messageIndex++;
          continue;
        }
        if (type === "model.result") {
          const finishReason = typeof traceRecord.finishReason === "string"
            ? traceRecord.finishReason
            : "";
          if (finishReason !== "tool_calls") {
            messageIndex++;
          }
          continue;
        }
        if (type === "tool.call") {
          const actionCallId = typeof traceRecord.actionCallId === "string"
            ? traceRecord.actionCallId
            : undefined;
          const parentActionCallId =
            typeof traceRecord.parentActionCallId === "string"
              ? traceRecord.parentActionCallId
              : undefined;
          const name = typeof traceRecord.name === "string"
            ? traceRecord.name
            : undefined;
          inserts.push({
            actionCallId,
            parentActionCallId,
            name,
            index: Math.min(messageIndex, messageCount),
          });
        }
      }
      return inserts;
    };
    const map = new Map<number, ToolCallSummary[]>();
    if (!toolCallSummaries.length) return map;
    const traceInserts = Array.isArray(run.traces) && run.traces.length > 0
      ? deriveInsertsFromTraces(run.traces, run.messages.length)
      : [];
    const insertMap = new Map<
      string,
      { index: number; name?: string; parentActionCallId?: string }
    >();
    const inserts = traceInserts.length > 0 ? traceInserts : run.toolInserts ??
      [];
    inserts.forEach((insert) => {
      if (
        typeof insert?.index === "number" &&
        insert.index >= 0 &&
        insert.actionCallId
      ) {
        insertMap.set(insert.actionCallId, {
          index: insert.index,
          name: insert.name ?? undefined,
          parentActionCallId: insert.parentActionCallId ?? undefined,
        });
      }
    });
    for (const call of toolCallSummaries) {
      const insert = call.id ? insertMap.get(call.id) : undefined;
      const index = insert?.index ?? run.messages.length;
      const enriched = insert
        ? {
          ...call,
          name: call.name ?? insert.name,
          parentActionCallId: call.parentActionCallId ??
            insert.parentActionCallId,
        }
        : call;
      const bucket = map.get(index);
      if (bucket) {
        bucket.push(enriched);
      } else {
        map.set(index, [enriched]);
      }
    }
    return map;
  }, [toolCallSummaries, run.toolInserts, run.traces, run.messages.length]);
  const assistantLatencyByMessageIndex = useMemo(() => {
    const map: Record<number, number> = {};
    let assistantTurn = 0;
    run.messages.forEach((msg, index) => {
      if (msg.role !== "assistant") return;
      const latency = latencyByTurn[assistantTurn];
      if (typeof latency === "number") {
        map[index] = latency;
      }
      assistantTurn += 1;
    });
    return map;
  }, [run.messages, latencyByTurn]);
  const canRunPersona = testDecks.length > 0;
  const hasPersonaSelection = canRunPersona && Boolean(selectedDeckId);
  const canStart = hasPersonaSelection &&
    (!botInputSchema || missingBotInput.length === 0) &&
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
    const shouldScroll = run.messages.length > lastRunMessageCountRef.current ||
      Boolean(streamingUser?.text || streamingAssistant?.text);
    lastRunMessageCountRef.current = run.messages.length;
    if (!shouldScroll) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    run.id,
    run.messages.length,
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
          botDeckPath: selectedDeckId ?? undefined,
        }),
      });
      const data = await res.json() as { run?: TestBotRun };
      if (data.run) {
        setRun({
          ...data.run,
          messages: data.run.messages ?? [],
          traces: data.run.traces ?? [],
          toolInserts: data.run.toolInserts ?? [],
        });
      } else {
        setRun({
          status: "running",
          messages: [],
          traces: [],
          toolInserts: [],
        });
      }
      refreshStatus({ runId: data.run?.id });
    } catch (err) {
      console.error(err);
    }
  }, [
    deckInitValue,
    botInputValue,
    initialUserMessage,
    refreshStatus,
    selectedDeckId,
  ]);

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
      refreshStatus({ runId: run.id });
    }
  }, [refreshStatus, run.id]);

  const handleNewChat = useCallback(async () => {
    if (run.status === "running") {
      await stopRun();
    }
    setRun({
      status: "idle",
      messages: [],
      traces: [],
      toolInserts: [],
    });
    onResetTestBotSession();
  }, [onResetTestBotSession, run.status, stopRun]);

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

  const handleDeckSelection = useCallback(async (nextId: string) => {
    if (!nextId) return;
    if (nextId === selectedDeckId) return;
    await handleNewChat();
    setSelectedDeckId(nextId);
    loadTestBot({ deckId: nextId });
  }, [handleNewChat, loadTestBot, selectedDeckId]);

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
            Active deck: <code>{deckPath}</code>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="primary" onClick={handleNewChat}>
            New chat
          </button>
        </div>
      </div>
      <div className="editor-main">
        <div
          className="editor-panel test-bot-sidebar"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <strong>Persona deck</strong>
          {testDecks.length > 0 && (
            <select
              value={selectedDeckId ?? ""}
              onChange={(e) => handleDeckSelection(e.target.value)}
              style={{
                width: "100%",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                padding: 8,
                fontFamily: "inherit",
              }}
            >
              {testDecks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.label}
                </option>
              ))}
            </select>
          )}
          {testDecks.length === 0 && (
            <div className="placeholder">
              No deck-defined personas found. Add <code>[[testDecks]]</code>
              {" "}
              to your deck front matter to drive the Test Bot.
            </div>
          )}
          <div className="editor-status">
            {botLabel ?? "Persona"} · <code>{botPath ?? "unknown path"}</code>
          </div>
          {botDescription && <div className="placeholder">{botDescription}
          </div>}
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
            data-testid="testbot-initial-message"
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
          <div className="placeholder">
            Persona content is managed by the selected deck. Edit{" "}
            <code>{botPath ?? "the referenced deck"}</code>{" "}
            to change its behavior.
          </div>
        </div>
        <div
          className="editor-panel"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <strong>Latest test run</strong>
              <div className="editor-status">{runStatusLabel}</div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "row-reverse",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="primary"
                onClick={startRun}
                disabled={!canStart}
                data-testid="testbot-run"
              >
                Run test bot
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={stopRun}
                disabled={run.status !== "running"}
                data-testid="testbot-stop"
              >
                Stop
              </button>
            </div>
          </div>
          {run.error && <div className="error">{run.error}</div>}
          {run.sessionId && (
            <div className="editor-status">
              Session:{" "}
              <code data-testid="testbot-session-id">{run.sessionId}</code>
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
          {!canStart && canRunPersona && (
            <div className="error">
              {!hasPersonaSelection
                ? "Select a persona deck to run."
                : botJsonErrorCount > 0 || deckJsonErrorCount > 0
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
            {(() => {
              const rows: React.ReactNode[] = [];
              const renderToolBucket = (index: number) => {
                const bucket = toolBuckets.get(index);
                if (!bucket || bucket.length === 0) return;
                const isOpen = Boolean(toolCallsOpen[index]);
                let latencyLabel: string | null = null;
                for (let i = index; i < run.messages.length; i += 1) {
                  if (run.messages[i]?.role === "assistant") {
                    const latency = assistantLatencyByMessageIndex[i];
                    if (typeof latency === "number") {
                      latencyLabel = `${Math.max(0, Math.round(latency))}ms`;
                    }
                    break;
                  }
                }
                rows.push(
                  <div
                    key={`tool-bucket-${index}`}
                    className="tool-calls-collapsible"
                  >
                    <button
                      type="button"
                      className="tool-calls-toggle"
                      onClick={() =>
                        setToolCallsOpen((prev) => ({
                          ...prev,
                          [index]: !prev[index],
                        }))}
                    >
                      <span className="tool-calls-toggle-label">
                        Tool calls ({bucket.length})
                        {latencyLabel ? ` · ${latencyLabel}` : ""} ·{" "}
                        {isOpen ? "Hide" : "Show"}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="tool-calls-list">
                        {bucket.map((call, callIdx) => (
                          <ToolCallBubble
                            key={`tool-${call.id}-${index}-${callIdx}`}
                            call={call}
                          />
                        ))}
                      </div>
                    )}
                  </div>,
                );
              };
              renderToolBucket(0);
              run.messages.forEach((m, idx) => {
                rows.push(
                  <div
                    key={`${m.role}-${idx}`}
                    className={`imessage-row ${
                      m.role === "user" ? "left" : "right"
                    }`}
                  >
                    <div
                      className={`imessage-bubble ${
                        m.role === "user" ? "right" : "left"
                      }`}
                      title={m.role}
                    >
                      {m.content}
                      {m.messageRefId && run.sessionId && (
                        <FeedbackControls
                          messageRefId={m.messageRefId}
                          feedback={m.feedback}
                          onScore={handleTestBotScore}
                          onReasonChange={handleTestBotReason}
                        />
                      )}
                    </div>
                  </div>,
                );
                renderToolBucket(idx + 1);
              });
              return rows;
            })()}
            {streamingUser?.text && streamingUser.runId === run.id &&
              (streamingUser.expectedUserCount === undefined ||
                countUserMessages(run.messages) <
                  streamingUser.expectedUserCount) &&
              (
                <div className="imessage-row left">
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
                <div className="imessage-row right">
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
          <strong>Context (gambit_context)</strong>
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

function normalizeAppPath(input: string): string {
  const trimmed = input.replace(/\/+$/, "") || "/";
  if (trimmed === "/" || trimmed === "") {
    if (window.location.pathname !== DOCS_PATH) {
      window.history.replaceState({}, "", DOCS_PATH);
    }
    return DOCS_PATH;
  }
  if (trimmed === DOCS_PATH) {
    if (window.location.pathname !== DOCS_PATH) {
      window.history.replaceState({}, "", DOCS_PATH);
    }
    return DOCS_PATH;
  }
  if (trimmed === "/test-bot") {
    if (window.location.pathname !== DEFAULT_TEST_BOT_PATH) {
      window.history.replaceState({}, "", DEFAULT_TEST_BOT_PATH);
    }
    return DEFAULT_TEST_BOT_PATH;
  }
  if (
    trimmed === "/debug" || trimmed === "/simulate" ||
    trimmed === SESSIONS_BASE_PATH
  ) {
    if (window.location.pathname !== DEFAULT_SESSION_PATH) {
      window.history.replaceState({}, "", DEFAULT_SESSION_PATH);
    }
    return DEFAULT_SESSION_PATH;
  }
  if (/^\/sessions\/[^/]+\/(debug|test-bot|calibrate)$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\/sessions\/[^/]+\/calibrate/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/debug/sessions/")) {
    const raw = trimmed.slice("/debug/sessions/".length);
    const decoded = decodeURIComponent(raw);
    const next = `${SESSIONS_BASE_PATH}/${encodeURIComponent(decoded)}/debug`;
    window.history.replaceState({}, "", next);
    return next;
  }
  if (
    trimmed.startsWith("/sessions/") && !trimmed.includes("/debug") &&
    trimmed !== DEFAULT_SESSION_PATH
  ) {
    const remainder = trimmed.slice("/sessions/".length);
    if (remainder && remainder !== "new") {
      const decoded = decodeURIComponent(remainder);
      const next = `${SESSIONS_BASE_PATH}/${encodeURIComponent(decoded)}/debug`;
      window.history.replaceState({}, "", next);
      return next;
    }
  }
  return trimmed || DEFAULT_SESSION_PATH;
}

function App() {
  const simulatorBasePath = SESSIONS_BASE_PATH;
  const [path, setPath] = useState(() =>
    normalizeAppPath(window.location.pathname)
  );
  const [bundleStamp, setBundleStamp] = useState<string | null>(null);
  const activeSessionId = getSessionIdFromPath(path);

  useEffect(() => {
    const handler = () => setPath(normalizeAppPath(window.location.pathname));
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

  const replacePath = useCallback((next: string) => {
    if (next === path) return;
    window.history.replaceState({}, "", next);
    setPath(next);
  }, [path]);

  const isDocs = path === DOCS_PATH;
  const isTestBot = !isDocs && /\/test-bot$/.test(path);
  const isCalibrate = !isDocs &&
    (path.startsWith("/calibrate") ||
      /^\/sessions\/[^/]+\/calibrate/.test(path));
  const currentPage = isDocs
    ? "docs"
    : isTestBot
    ? "test-bot"
    : isCalibrate
    ? "calibrate"
    : "debug";
  const testBotPath = activeSessionId
    ? `${SESSIONS_BASE_PATH}/${encodeURIComponent(activeSessionId)}/test-bot`
    : DEFAULT_TEST_BOT_PATH;
  const debugPath = activeSessionId
    ? `${SESSIONS_BASE_PATH}/${encodeURIComponent(activeSessionId)}/debug`
    : DEFAULT_SESSION_PATH;
  const calibratePath = activeSessionId
    ? buildCalibratePath(activeSessionId)
    : "/calibrate";

  return (
    <>
      <div className="app-root">
        <div className="top-nav">
          <div className="top-nav-buttons">
            <button
              type="button"
              className={currentPage === "docs" ? "active" : ""}
              onClick={() => navigate(DOCS_PATH)}
              data-testid="nav-docs"
            >
              Docs
            </button>
            <button
              type="button"
              className={currentPage === "test-bot" ? "active" : ""}
              onClick={() => navigate(testBotPath)}
              data-testid="nav-test-bot"
            >
              Test Bot
            </button>
            <button
              type="button"
              className={currentPage === "calibrate" ? "active" : ""}
              onClick={() => navigate(calibratePath)}
              data-testid="nav-calibrate"
            >
              Calibrate
            </button>
            <button
              type="button"
              className={classNames(
                "top-nav-link",
                currentPage === "debug" && "active",
              )}
              onClick={() => navigate(debugPath)}
              data-testid="nav-debug"
            >
              Debug
            </button>
          </div>
          <div className="top-nav-info">
            {bundleStamp && (
              <span className="bundle-stamp">Bundle: {bundleStamp}</span>
            )}
          </div>
        </div>
        <div className="page-shell">
          {currentPage === "docs"
            ? <DocsPage />
            : currentPage === "debug"
            ? <SimulatorApp basePath={simulatorBasePath} />
            : currentPage === "test-bot"
            ? (
              <TestBotApp
                onNavigateToSession={(sessionId) =>
                  navigate(
                    `${simulatorBasePath}/${
                      encodeURIComponent(sessionId)
                    }/debug`,
                  )}
                onReplaceTestBotSession={(sessionId) =>
                  replacePath(
                    `${simulatorBasePath}/${
                      encodeURIComponent(sessionId)
                    }/test-bot`,
                  )}
                onResetTestBotSession={() => replacePath(DEFAULT_TEST_BOT_PATH)}
                activeSessionId={activeSessionId}
              />
            )
            : <CalibrateApp />}
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
