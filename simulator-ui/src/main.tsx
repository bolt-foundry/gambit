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
import Button from "./gds/Button.tsx";
import {
  buildCalibratePath,
  buildDurableStreamUrl,
  CALIBRATE_STREAM_ID,
  classNames,
  cloneValue,
  deckDisplayPath,
  deckLabel,
  deckPath,
  DEFAULT_SESSION_PATH,
  DEFAULT_TEST_BOT_PATH,
  deriveInitialFromSchema,
  DOCS_PATH,
  extractConversationContext,
  extractGradingFlags,
  extractInitFromTraces,
  extractScoreAndReason,
  extractScoreAndReasonFromSample,
  extractTotalTurns,
  extractTotalTurnsFromResult,
  extractTurnContext,
  findMissingRequiredFields,
  formatSnippet,
  formatTimestamp,
  formatTimestampShort,
  getCalibrateRefFromLocation,
  getCalibrateSessionIdFromLocation,
  getDurableStreamOffset,
  getScoreClass,
  getSessionIdFromPath,
  isTurnsResult,
  normalizeAppPath,
  normalizeBasePath,
  normalizedDeckPath,
  normalizeFsPath,
  parseGradingRef,
  repoRootPath,
  SCORE_VALUES,
  SESSIONS_BASE_PATH,
  setDurableStreamOffset,
  SIMULATOR_STREAM_ID,
  toDeckSlug,
  toRelativePath,
} from "./utils.ts";
import type {
  CalibrateRef,
  CalibrateResponse,
  CalibrateSession,
  CalibrateStreamMessage,
  CalibrationRun,
  GraderDeckMeta,
  GradingFlag,
  ModelMessage,
  SavedState,
  SessionDetailResponse,
  SessionMeta,
  SimulatorMessage,
  TraceEvent,
} from "./utils.ts";
import {
  ConversationView,
  CopyBadge,
  InitPanel,
  TraceList,
  useHttpSchema,
} from "./shared.tsx";
import TestBotPage from "./TestBotPage.tsx";

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
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </header>
        <div className="sessions-body">
          <Button variant="secondary" onClick={onRefresh}>Refresh</Button>
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
        <Button variant="ghost" onClick={onOpenAll}>
          View all sessions
        </Button>
      </div>
    </div>
  );
}

function SimulatorApp(
  { basePath, setNavActions }: {
    basePath: string;
    setNavActions?: (actions: React.ReactNode | null) => void;
  },
) {
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

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(
      <>
        {sessionId && (
          <a
            href={buildCalibratePath(sessionId)}
            className="gds-button gds-button--ghost"
            title="Open Calibrate tab for this session"
          >
            Calibrate session
          </a>
        )}
        <Button variant="secondary" onClick={() => setSessionsOpen(true)}>
          Sessions
        </Button>
        <Button
          variant={pendingReset ? "primary" : "secondary"}
          onClick={() => startNewChat()}
        >
          New Chat
        </Button>
        <div className={`status-indicator ${simulator.connectionStatus}`}>
          {simulator.connectionStatus}
        </div>
      </>,
    );
    return () => setNavActions(null);
  }, [
    pendingReset,
    setNavActions,
    sessionId,
    simulator.connectionStatus,
    startNewChat,
  ]);

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
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={schema && initEditable && !canStartWithInit}
            data-testid="debug-send"
          >
            {schema && initEditable ? "Start chat" : "Send"}
          </Button>
          <Button variant="secondary" onClick={simulator.reconnect}>
            Reconnect
          </Button>
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

function CalibrateApp(
  { setNavActions, onAppPathChange }: {
    setNavActions?: (actions: React.ReactNode | null) => void;
    onAppPathChange?: (path: string) => void;
  },
) {
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
    onAppPathChange?.(targetPath);
  }, [onAppPathChange]);

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

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(
      <Button
        variant="ghost"
        onClick={loadCalibrateData}
        disabled={loading}
      >
        Refresh data
      </Button>,
    );
    return () => setNavActions(null);
  }, [loadCalibrateData, loading, setNavActions]);

  return (
    <div className="app-shell calibrate-shell">
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
                      <Button
                        variant="primary"
                        onClick={runGrader}
                        disabled={!canRun}
                      >
                        {running ? "Running…" : "Run grader"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={loadCalibrateData}
                        disabled={loading}
                      >
                        Refresh sessions
                      </Button>
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
                            <Button
                              variant="ghost"
                              className="calibrate-run-toggle"
                              onClick={() =>
                                setExpandedRunId((prev) =>
                                  prev === section.run.id
                                    ? null
                                    : section.run.id
                                )}
                            >
                              {isExpanded ? "Collapse" : "Expand"}
                            </Button>
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
                                          <Button
                                            variant="ghost"
                                            className={classNames(
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
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            className="calibrate-ref-copy"
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
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            className="calibrate-toggle"
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
                                          </Button>
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
                                                <Button
                                                  variant="ghost"
                                                  className="calibrate-toggle"
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
                                                </Button>
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
                                                <Button
                                                  variant="ghost"
                                                  className="calibrate-toggle"
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
                                                </Button>
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
                                                <Button
                                                  variant="ghost"
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
                                                </Button>
                                                <Button
                                                  variant="primary"
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
                                                </Button>
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
                <Button variant="primary" onClick={handleCopyStatePath}>
                  {copiedStatePath ? "Copied" : "Copy state path"}
                </Button>
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
                      className="gds-button gds-button--ghost"
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

function App() {
  const simulatorBasePath = SESSIONS_BASE_PATH;
  const [path, setPath] = useState(() =>
    normalizeAppPath(window.location.pathname)
  );
  const [bundleStamp, setBundleStamp] = useState<string | null>(null);
  const [navActions, setNavActions] = useState<React.ReactNode>(null);
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
  const handleAppPathChange = useCallback((next: string) => {
    setPath(normalizeAppPath(next));
  }, []);

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
            <Button
              variant={currentPage === "docs" ? "primary" : "secondary"}
              onClick={() => navigate(DOCS_PATH)}
              data-testid="nav-docs"
            >
              Docs
            </Button>
            <Button
              variant={currentPage === "test-bot" ? "primary" : "secondary"}
              onClick={() => navigate(testBotPath)}
              data-testid="nav-test-bot"
            >
              Test Bot
            </Button>
            <Button
              variant={currentPage === "calibrate" ? "primary" : "secondary"}
              onClick={() => navigate(calibratePath)}
              data-testid="nav-calibrate"
            >
              Calibrate
            </Button>
            <Button
              variant={currentPage === "debug" ? "primary" : "ghost"}
              onClick={() => navigate(debugPath)}
              data-testid="nav-debug"
            >
              Debug
            </Button>
          </div>
          <div className="top-nav-center">
            <span className="top-nav-deck" title={deckPath}>
              {deckLabel}
            </span>
          </div>
          <div className="top-nav-right">
            {navActions && <div className="top-nav-actions">{navActions}</div>}
            {bundleStamp && (
              <div className="top-nav-info">
                <span className="bundle-stamp">Bundle: {bundleStamp}</span>
              </div>
            )}
          </div>
        </div>
        <div className="page-shell">
          {currentPage === "docs"
            ? <DocsPage />
            : currentPage === "debug"
            ? (
              <SimulatorApp
                basePath={simulatorBasePath}
                setNavActions={setNavActions}
              />
            )
            : currentPage === "test-bot"
            ? (
              <TestBotPage
                onReplaceTestBotSession={(sessionId) =>
                  replacePath(
                    `${simulatorBasePath}/${
                      encodeURIComponent(sessionId)
                    }/test-bot`,
                  )}
                onResetTestBotSession={() => replacePath(DEFAULT_TEST_BOT_PATH)}
                activeSessionId={activeSessionId}
                setNavActions={setNavActions}
              />
            )
            : (
              <CalibrateApp
                setNavActions={setNavActions}
                onAppPathChange={handleAppPathChange}
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
