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
import WorkbenchDrawer from "./WorkbenchDrawer.tsx";
import SessionsDrawer from "./SessionsDrawer.tsx";
import { BuildChatProvider } from "./BuildChatContext.tsx";
import {
  buildConversationEntries,
  buildDurableStreamUrl,
  buildGradePath,
  buildTabEnabled,
  classNames,
  cloneValue,
  deckDisplayPath,
  deckLabel,
  deckPath,
  DEFAULT_SESSION_PATH,
  DEFAULT_TEST_PATH,
  deriveInitialFromSchema,
  DOCS_PATH,
  extractInitFromTraces,
  findMissingRequiredFields,
  formatTimestamp,
  getDurableStreamOffset,
  getSessionIdFromPath,
  normalizeAppPath,
  normalizeBasePath,
  normalizedDeckPath,
  normalizeFsPath,
  repoRootPath,
  SCORE_VALUES,
  SESSIONS_BASE_PATH,
  setDurableStreamOffset,
  SIMULATOR_STREAM_ID,
  toRelativePath,
} from "./utils.ts";
import type {
  FeedbackEntry,
  GradingFlag,
  SavedState,
  SessionDetailResponse,
  SessionMeta,
  SimulatorMessage,
  TraceEvent,
} from "./utils.ts";
import {
  ConversationView,
  InitPanel,
  TraceList,
  useHttpSchema,
} from "./shared.tsx";
import GradePage from "./GradePage.tsx";
import TestBotPage from "./TestBotPage.tsx";
import BuildPage from "./BuildPage.tsx";
import PageGrid from "./gds/PageGrid.tsx";
import PageShell from "./gds/PageShell.tsx";
import Icon from "./gds/Icon.tsx";
import Tabs from "./gds/Tabs.tsx";

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
    async (messageRefId: string, score: number | null, reason?: string) => {
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
  const byNewest = useCallback((items: SessionMeta[]) => {
    return [...items].sort((a, b) => {
      const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
      const safeATime = Number.isFinite(aTime) ? aTime : 0;
      const safeBTime = Number.isFinite(bTime) ? bTime : 0;
      return safeBTime - safeATime;
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/sessions");
      if (!res.ok) throw new Error(res.statusText);
      const body = await res.json() as { sessions?: SessionMeta[] };
      setSessions(byNewest(body.sessions ?? []));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load sessions",
      );
    } finally {
      setLoading(false);
    }
  }, [byNewest]);

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

  const deleteAll = useCallback(async (scope?: SessionMeta[]) => {
    setLoading(true);
    setError(null);
    try {
      let targetSessions = scope;
      if (!targetSessions) {
        const res = await fetch("/sessions");
        if (!res.ok) throw new Error(res.statusText);
        const body = await res.json() as { sessions?: SessionMeta[] };
        targetSessions = body.sessions ?? [];
      }
      await Promise.allSettled(
        (targetSessions ?? []).map((session) =>
          fetch("/api/session/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: session.id }),
          })
        ),
      );
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete sessions",
      );
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  return { sessions, loading, error, refresh, deleteSession, deleteAll };
}

type SessionsApi = ReturnType<typeof useSessions>;

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
  {
    basePath,
    setNavActions,
    sessionsApi,
    onOpenSessionsDrawer,
    activeSessionId,
  }: {
    basePath: string;
    setNavActions?: (actions: React.ReactNode | null) => void;
    sessionsApi: SessionsApi;
    onOpenSessionsDrawer: () => void;
    activeSessionId?: string | null;
  },
) {
  const simulator = useSimulator();
  const httpSchema = useHttpSchema();
  const {
    sessions,
    loading: sessionsLoading,
    error: sessionsError,
    refresh,
  } = sessionsApi;
  const { resetLocal } = simulator;
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
  const externalSessionIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
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
    return buildConversationEntries(simulator.savedState);
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
      resetLocal();
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
    [schema, resetLocal, resetInitValue, newSessionPath],
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
    if (!activeSessionId) {
      externalSessionIdRef.current = null;
      return;
    }
    if (externalSessionIdRef.current === activeSessionId) return;
    externalSessionIdRef.current = activeSessionId;
    adoptSessionFromPath(activeSessionId);
  }, [activeSessionId, adoptSessionFromPath]);

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
    (refId: string, score: number | null) => {
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
        <Button
          variant="secondary"
          onClick={() => startNewChat()}
        >
          New chat
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
      if (typeof session.deck === "string") {
        const normalizedSessionDeck = normalizeFsPath(session.deck);
        if (normalizedSessionDeck === normalizedDeckPath) return true;
        const relative = toRelativePath(normalizedSessionDeck, repoRootPath);
        if (
          relative &&
          normalizeFsPath(relative) === normalizeFsPath(deckDisplayPath)
        ) {
          return true;
        }
      }
      return false;
    });
  }, [sessions, deckDisplayPath, normalizedDeckPath, repoRootPath]);

  const recentSessionsEmpty = (
    <RecentSessionsEmptyState
      sessions={deckSessions}
      loading={sessionsLoading}
      error={sessionsError}
      onSelect={(id) => navigateToSession(id)}
      onOpenAll={onOpenSessionsDrawer}
    />
  );

  return (
    <PageShell>
      <PageGrid as="main" className="app-main">
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
      </PageGrid>
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
    </PageShell>
  );
}

function App() {
  const simulatorBasePath = SESSIONS_BASE_PATH;
  const [path, setPath] = useState(() =>
    normalizeAppPath(window.location.pathname)
  );
  const [bundleStamp, setBundleStamp] = useState<string | null>(null);
  const [navActions, setNavActions] = useState<React.ReactNode>(null);
  const [sessionsDrawerOpen, setSessionsDrawerOpen] = useState(false);
  const [workbenchDrawerOpen, setWorkbenchDrawerOpen] = useState(false);
  const sessionsApi = useSessions();
  const [testBotResetToken, setTestBotResetToken] = useState(0);
  const activeSessionId = getSessionIdFromPath(path);
  const [workbenchSessionDetail, setWorkbenchSessionDetail] = useState<
    SessionDetailResponse | null
  >(null);
  const [workbenchSessionDetailError, setWorkbenchSessionDetailError] =
    useState<string | null>(null);
  const [workbenchSessionDetailLoading, setWorkbenchSessionDetailLoading] =
    useState(false);
  const workbenchSessionDetailRequestRef = useRef(0);
  const workbenchSessionRetryRef = useRef<Record<string, number>>({});
  const workbenchRefreshTimeoutRef = useRef<number | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);

  useEffect(() => {
    const handler = () => setPath(normalizeAppPath(window.location.pathname));
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const loadWorkbenchSessionDetail = useCallback(async (sessionId: string) => {
    const requestId = ++workbenchSessionDetailRequestRef.current;
    const shouldApply = () =>
      requestId === workbenchSessionDetailRequestRef.current &&
      activeSessionIdRef.current === sessionId;
    try {
      setWorkbenchSessionDetailLoading(true);
      setWorkbenchSessionDetailError(null);
      const res = await fetch(
        `/api/session?sessionId=${encodeURIComponent(sessionId)}`,
      );
      if (!res.ok) {
        if (!shouldApply()) return;
        if (res.status === 404 || res.status === 502) {
          const attempts = workbenchSessionRetryRef.current[sessionId] ?? 0;
          if (attempts < 5) {
            workbenchSessionRetryRef.current[sessionId] = attempts + 1;
            setWorkbenchSessionDetailLoading(false);
            setWorkbenchSessionDetailError(null);
            window.setTimeout(() => {
              if (
                workbenchSessionDetailRequestRef.current === requestId &&
                activeSessionIdRef.current === sessionId
              ) {
                loadWorkbenchSessionDetail(sessionId).catch(() => {});
              }
            }, 500);
            return;
          }
        }
        const text = await res.text().catch(() => "");
        throw new Error(text || res.statusText);
      }
      const detail = await res.json().catch(() => null);
      if (!shouldApply()) return;
      setWorkbenchSessionDetail(
        detail && typeof detail === "object"
          ? (detail as SessionDetailResponse)
          : null,
      );
      setWorkbenchSessionDetailError(null);
    } catch (err) {
      if (!shouldApply()) return;
      setWorkbenchSessionDetail(
        null,
      );
      setWorkbenchSessionDetailError(
        err instanceof Error ? err.message : "Failed to load session detail",
      );
    } finally {
      if (shouldApply()) {
        setWorkbenchSessionDetailLoading(false);
      }
    }
  }, []);

  const scheduleWorkbenchRefresh = useCallback(() => {
    if (!activeSessionId) return;
    if (workbenchRefreshTimeoutRef.current) {
      window.clearTimeout(workbenchRefreshTimeoutRef.current);
    }
    const sessionId = activeSessionId;
    workbenchRefreshTimeoutRef.current = window.setTimeout(() => {
      if (activeSessionIdRef.current !== sessionId) return;
      loadWorkbenchSessionDetail(sessionId).catch(() => {});
    }, 900);
  }, [activeSessionId, loadWorkbenchSessionDetail]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    if (workbenchRefreshTimeoutRef.current) {
      window.clearTimeout(workbenchRefreshTimeoutRef.current);
      workbenchRefreshTimeoutRef.current = null;
    }
  }, [activeSessionId]);

  useEffect(() => {
    return () => {
      if (workbenchRefreshTimeoutRef.current) {
        window.clearTimeout(workbenchRefreshTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      setWorkbenchSessionDetail(null);
      setWorkbenchSessionDetailError(null);
      setWorkbenchSessionDetailLoading(false);
      return;
    }
    loadWorkbenchSessionDetail(activeSessionId).catch(() => {});
  }, [activeSessionId, loadWorkbenchSessionDetail]);

  const applyFeedbackUpdate = useCallback((
    messageRefId: string,
    feedback: FeedbackEntry | null,
  ) => {
    setWorkbenchSessionDetail((prev) => {
      if (!prev) return prev;
      const existing = prev.feedback ?? [];
      if (!feedback) {
        if (!existing.length) return prev;
        return {
          ...prev,
          feedback: existing.filter((entry) =>
            entry.messageRefId !== messageRefId
          ),
        };
      }
      const index = existing.findIndex((entry) =>
        entry.messageRefId === messageRefId
      );
      const nextFeedback = index >= 0
        ? existing.map((entry, idx) => (idx === index ? feedback : entry))
        : [feedback, ...existing];
      return { ...prev, feedback: nextFeedback };
    });
    scheduleWorkbenchRefresh();
  }, [scheduleWorkbenchRefresh]);

  const applyFlagsUpdate = useCallback((flags: GradingFlag[]) => {
    setWorkbenchSessionDetail((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        meta: {
          ...(prev.meta ?? {}),
          gradingFlags: flags,
        },
      };
    });
    scheduleWorkbenchRefresh();
  }, [scheduleWorkbenchRefresh]);

  const optimisticToggleFlag = useCallback((item: {
    refId: string;
    runId: string;
    turnIndex?: number;
  }) => {
    setWorkbenchSessionDetail((prev) => {
      if (!prev) return prev;
      const meta = prev.meta ?? {};
      const existing = Array.isArray(
          (meta as { gradingFlags?: unknown })
            .gradingFlags,
        )
        ? ((meta as { gradingFlags?: unknown }).gradingFlags as GradingFlag[])
        : [];
      const isFlagged = existing.some((flag) => flag.refId === item.refId);
      const nextFlags = isFlagged
        ? existing.filter((flag) => flag.refId !== item.refId)
        : [
          {
            id: `optimistic:${item.refId}:${Date.now()}`,
            refId: item.refId,
            runId: item.runId,
            turnIndex: item.turnIndex,
            createdAt: new Date().toISOString(),
          },
          ...existing,
        ];
      return {
        ...prev,
        meta: {
          ...meta,
          gradingFlags: nextFlags,
        },
      };
    });
    scheduleWorkbenchRefresh();
  }, [scheduleWorkbenchRefresh]);

  const optimisticFlagReason = useCallback((refId: string, reason: string) => {
    setWorkbenchSessionDetail((prev) => {
      if (!prev) return prev;
      const meta = prev.meta ?? {};
      const existing = Array.isArray(
          (meta as { gradingFlags?: unknown })
            .gradingFlags,
        )
        ? ((meta as { gradingFlags?: unknown }).gradingFlags as GradingFlag[])
        : [];
      if (!existing.length) return prev;
      return {
        ...prev,
        meta: {
          ...meta,
          gradingFlags: existing.map((flag) =>
            flag.refId === refId ? { ...flag, reason } : flag
          ),
        },
      };
    });
    scheduleWorkbenchRefresh();
  }, [scheduleWorkbenchRefresh]);

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
  const handleReplaceTestBotSession = useCallback(
    (sessionId: string) =>
      replacePath(
        `${simulatorBasePath}/${encodeURIComponent(sessionId)}/test`,
      ),
    [replacePath, simulatorBasePath],
  );
  const handleResetTestBotSession = useCallback(
    () => replacePath(DEFAULT_TEST_PATH),
    [replacePath],
  );

  useEffect(() => {
    if (!buildTabEnabled && path === "/build") {
      replacePath(DOCS_PATH);
    }
  }, [path, replacePath]);

  const isDocs = path === DOCS_PATH;
  const isBuild = buildTabEnabled && path === "/build";
  const isTestBot = !isDocs && /\/test$/.test(path);
  const isGrade = !isDocs &&
    (path.startsWith("/grade") ||
      /^\/sessions\/[^/]+\/grade/.test(path));
  const currentPage = isDocs
    ? "docs"
    : isBuild
    ? "build"
    : isTestBot
    ? "test"
    : isGrade
    ? "grade"
    : "debug";
  const testBotPath = activeSessionId
    ? `${SESSIONS_BASE_PATH}/${encodeURIComponent(activeSessionId)}/test`
    : DEFAULT_TEST_PATH;
  const debugPath = activeSessionId
    ? `${SESSIONS_BASE_PATH}/${encodeURIComponent(activeSessionId)}/debug`
    : DEFAULT_SESSION_PATH;
  const gradePath = activeSessionId
    ? buildGradePath(activeSessionId)
    : "/grade";
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const nextPath = currentPage === "test" || currentPage === "docs"
        ? `${SESSIONS_BASE_PATH}/${encodeURIComponent(sessionId)}/test`
        : currentPage === "grade"
        ? buildGradePath(sessionId)
        : `${SESSIONS_BASE_PATH}/${encodeURIComponent(sessionId)}/debug`;
      navigate(nextPath);
      setSessionsDrawerOpen(false);
    },
    [currentPage, navigate],
  );

  useEffect(() => {
    if (sessionsDrawerOpen) {
      sessionsApi.refresh();
    }
  }, [sessionsApi.refresh, sessionsDrawerOpen]);

  const deckSessions = useMemo(() => {
    return sessionsApi.sessions.filter((session) => {
      if (!session) return false;
      if (typeof session.deck === "string") {
        const normalizedSessionDeck = normalizeFsPath(session.deck);
        if (normalizedSessionDeck === normalizedDeckPath) return true;
        const relative = toRelativePath(normalizedSessionDeck, repoRootPath);
        if (
          relative &&
          normalizeFsPath(relative) === normalizeFsPath(deckDisplayPath)
        ) {
          return true;
        }
      }
      return false;
    });
  }, [
    sessionsApi.sessions,
    deckDisplayPath,
    normalizedDeckPath,
    repoRootPath,
  ]);

  const handleDeleteAll = useCallback(async () => {
    await sessionsApi.deleteAll(deckSessions);
    setTestBotResetToken((prev) => prev + 1);
    setSessionsDrawerOpen(false);
    window.location.assign(DEFAULT_TEST_PATH);
  }, [deckSessions, sessionsApi.deleteAll]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await sessionsApi.deleteSession(sessionId);
      if (sessionId === activeSessionId) {
        window.location.assign(DEFAULT_TEST_PATH);
      }
    },
    [activeSessionId, sessionsApi.deleteSession],
  );

  return (
    <>
      <div className="app-frame">
        <div className="app-root">
          <div className="top-nav">
            <div className="top-nav-left">
              <Button
                variant={sessionsDrawerOpen ? "primary-deemph" : "ghost"}
                className={classNames(
                  "sessions-toggle",
                  sessionsDrawerOpen && "active",
                )}
                onClick={() => setSessionsDrawerOpen(true)}
                data-testid="nav-sessions"
              >
                <Icon
                  name="hamburgerMenu"
                  size={17}
                  style={{ color: "var(--color-text)" }}
                />
              </Button>
            </div>
            <Tabs
              className="top-nav-buttons"
              activeId={currentPage}
              onChange={(next) =>
                navigate(
                  next === "docs"
                    ? DOCS_PATH
                    : next === "build"
                    ? "/build"
                    : next === "test"
                    ? testBotPath
                    : next === "grade"
                    ? gradePath
                    : debugPath,
                )}
              tabs={[
                { id: "docs", label: "Docs", testId: "nav-docs" },
                ...(buildTabEnabled
                  ? [{ id: "build", label: "Build", testId: "nav-build" }]
                  : []),
                { id: "test", label: "Test", testId: "nav-test" },
                { id: "grade", label: "Grade", testId: "nav-grade" },
                { id: "debug", label: "Debug", testId: "nav-debug" },
              ]}
            />
            <div className="top-nav-center">
              <span className="top-nav-deck" title={deckPath}>
                {deckLabel}
              </span>
            </div>
            <div className="top-nav-right">
              <div className="top-nav-actions">
                {navActions}
                <Button
                  variant={workbenchDrawerOpen ? "primary-deemph" : "ghost"}
                  className={classNames(
                    "workbench-toggle",
                    workbenchDrawerOpen && "active",
                  )}
                  onClick={() => setWorkbenchDrawerOpen(true)}
                  aria-label="Open workbench drawer"
                  data-testid="nav-workbench"
                >
                  <Icon
                    name="flag"
                    size={16}
                    style={{ color: "var(--color-text)" }}
                  />
                </Button>
              </div>
            </div>
          </div>
          <div className="page-shell">
            {currentPage === "docs"
              ? <DocsPage />
              : currentPage === "build"
              ? <BuildPage setNavActions={setNavActions} />
              : currentPage === "debug"
              ? (
                <SimulatorApp
                  basePath={simulatorBasePath}
                  setNavActions={setNavActions}
                  sessionsApi={sessionsApi}
                  onOpenSessionsDrawer={() => setSessionsDrawerOpen(true)}
                  activeSessionId={activeSessionId}
                />
              )
              : currentPage === "test"
              ? (
                <TestBotPage
                  onReplaceTestBotSession={handleReplaceTestBotSession}
                  onResetTestBotSession={handleResetTestBotSession}
                  activeSessionId={activeSessionId}
                  resetToken={testBotResetToken}
                  setNavActions={setNavActions}
                  onFeedbackUpdate={applyFeedbackUpdate}
                />
              )
              : (
                <GradePage
                  setNavActions={setNavActions}
                  onAppPathChange={handleAppPathChange}
                  activeSessionId={activeSessionId}
                  onFlagsUpdate={applyFlagsUpdate}
                  onOptimisticToggleFlag={optimisticToggleFlag}
                  onOptimisticFlagReason={optimisticFlagReason}
                />
              )}
          </div>
        </div>
        {workbenchDrawerOpen && (
          <WorkbenchDrawer
            open={workbenchDrawerOpen}
            onClose={() => setWorkbenchDrawerOpen(false)}
            loading={workbenchSessionDetailLoading}
            error={workbenchSessionDetailError}
            sessionId={activeSessionId}
            sessionDetail={workbenchSessionDetail}
          />
        )}
      </div>
      <SessionsDrawer
        open={sessionsDrawerOpen}
        sessions={deckSessions}
        loading={sessionsApi.loading}
        error={sessionsApi.error}
        onRefresh={sessionsApi.refresh}
        onSelect={handleSelectSession}
        onDelete={handleDeleteSession}
        onDeleteAll={handleDeleteAll}
        onClose={() => setSessionsDrawerOpen(false)}
        activeSessionId={activeSessionId}
        bundleStamp={bundleStamp}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BuildChatProvider>
      <App />
    </BuildChatProvider>
  </React.StrictMode>,
);
