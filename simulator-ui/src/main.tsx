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
import AppDrawer from "./AppDrawer.tsx";
import { WorkspaceProvider } from "./WorkspaceContext.tsx";
import {
  buildConversationEntries,
  buildDurableStreamUrl,
  buildGradePath,
  buildTabEnabled,
  buildTestPath,
  classNames,
  cloneValue,
  deckDisplayPath,
  deckLabel,
  deckPath,
  DEFAULT_GRADE_PATH,
  DEFAULT_TEST_PATH,
  deriveInitialFromSchema,
  DOCS_PATH,
  extractInitFromTraces,
  findMissingRequiredFields,
  formatTimestamp,
  getDurableStreamOffset,
  getWorkspaceIdFromPath,
  getWorkspaceRouteFromPath,
  normalizeAppPath,
  normalizeBasePath,
  normalizedDeckPath,
  normalizeFsPath,
  repoRootPath,
  SCORE_VALUES,
  setDurableStreamOffset,
  SIMULATOR_STREAM_ID,
  toRelativePath,
  workspaceIdFromWindow,
  WORKSPACES_BASE_PATH,
} from "./utils.ts";
import {
  buildWorkspacePath,
  WORKSPACE_API_BASE,
  WORKSPACES_API_BASE,
} from "../../src/workspace_contract.ts";
import type {
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

    const handleMessage = (event: MessageEvent<string>) => {
      let msg: SimulatorMessage | null = null;
      try {
        msg = JSON.parse(event.data) as SimulatorMessage;
      } catch (err) {
        console.error("[sim] failed to parse stream event payload", err);
        return;
      }
      const parsedOffset = Number(event.lastEventId);
      if (Number.isFinite(parsedOffset)) {
        setDurableStreamOffset(streamId, parsedOffset + 1);
      }
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

    const simulatorEventTypes: Array<SimulatorMessage["type"]> = [
      "ready",
      "pong",
      "stream",
      "result",
      "trace",
      "state",
      "error",
    ];
    for (const type of simulatorEventTypes) {
      source.addEventListener(type, handleMessage as EventListener);
    }

    return () => {
      for (const type of simulatorEventTypes) {
        source.removeEventListener(type, handleMessage as EventListener);
      }
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
            workspaceId: sessionId,
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
          body: JSON.stringify({
            workspaceId: sessionId,
            messageRefId,
            score,
            reason,
          }),
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
        body: JSON.stringify({ workspaceId: sessionId }),
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
          body: JSON.stringify({ workspaceId: sessionId, text }),
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
          body: JSON.stringify({ workspaceId: sessionId, score }),
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

function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<SessionMeta[]>([]);
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
      const res = await fetch(WORKSPACES_API_BASE);
      if (!res.ok) throw new Error(res.statusText);
      const body = await res.json() as { workspaces?: SessionMeta[] };
      setWorkspaces(byNewest(body.workspaces ?? []));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load workspaces",
      );
    } finally {
      setLoading(false);
    }
  }, [byNewest]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${WORKSPACE_API_BASE}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) throw new Error(res.statusText);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete workspace",
      );
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const deleteAll = useCallback(async (scope?: SessionMeta[]) => {
    setLoading(true);
    setError(null);
    try {
      let targetWorkspaces = scope;
      if (!targetWorkspaces) {
        const res = await fetch(WORKSPACES_API_BASE);
        if (!res.ok) throw new Error(res.statusText);
        const body = await res.json() as { workspaces?: SessionMeta[] };
        targetWorkspaces = body.workspaces ?? [];
      }
      await Promise.allSettled(
        (targetWorkspaces ?? []).map((workspace) =>
          fetch(`${WORKSPACE_API_BASE}/delete`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ workspaceId: workspace.id }),
          })
        ),
      );
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete workspaces",
      );
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  return { workspaces, loading, error, refresh, deleteWorkspace, deleteAll };
}

type WorkspacesApi = ReturnType<typeof useWorkspaces>;

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
    workspacesApi,
    onOpenSessionsDrawer,
    activeWorkspaceId,
  }: {
    basePath: string;
    setNavActions?: (actions: React.ReactNode | null) => void;
    workspacesApi: WorkspacesApi;
    onOpenSessionsDrawer: () => void;
    activeWorkspaceId?: string | null;
  },
) {
  const simulator = useSimulator();
  const httpSchema = useHttpSchema();
  const {
    workspaces,
    loading: workspacesLoading,
    error: workspacesError,
    refresh,
  } = workspacesApi;
  const { resetLocal } = simulator;
  const normalizedBase = normalizeBasePath(basePath || WORKSPACES_BASE_PATH);
  const rootPath = normalizedBase === "" ? "/" : normalizedBase;
  const sessionBasePath = rootPath === "/" ? WORKSPACES_BASE_PATH : rootPath;
  const normalizedSessionBase = normalizeBasePath(sessionBasePath);
  const newSessionPath = `${
    normalizedSessionBase === "" ? WORKSPACES_BASE_PATH : normalizedSessionBase
  }/new`.replace(/\/{2,}/g, "/");
  const buildSessionUrl = useCallback(
    (sessionId: string) =>
      `${
        normalizedSessionBase === ""
          ? WORKSPACES_BASE_PATH
          : normalizedSessionBase
      }/${encodeURIComponent(sessionId)}/debug`.replace(/\/{2,}/g, "/"),
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
    const initialSession = getWorkspaceIdFromPath(undefined, sessionBasePath) ??
      getWorkspaceIdFromPath();
    if (initialSession) {
      navigateToSession(initialSession, { replace: true });
      return;
    }
    startNewChat({ pushHistory: false });
  }, [navigateToSession, startNewChat, sessionBasePath]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      externalSessionIdRef.current = null;
      return;
    }
    if (externalSessionIdRef.current === activeWorkspaceId) return;
    externalSessionIdRef.current = activeWorkspaceId;
    adoptSessionFromPath(activeWorkspaceId);
  }, [activeWorkspaceId, adoptSessionFromPath]);

  useEffect(() => {
    const handler = () => {
      const sessionFromPath =
        getWorkspaceIdFromPath(undefined, sessionBasePath) ??
          getWorkspaceIdFromPath();
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
    return workspaces.filter((session) => {
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
  }, [workspaces, deckDisplayPath, normalizedDeckPath, repoRootPath]);

  const recentSessionsEmpty = (
    <RecentSessionsEmptyState
      sessions={deckSessions}
      loading={workspacesLoading}
      error={workspacesError}
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
  const simulatorBasePath = WORKSPACES_BASE_PATH;
  const [path, setPath] = useState(() =>
    normalizeAppPath(window.location.pathname)
  );
  const [bundleStamp, setBundleStamp] = useState<string | null>(null);
  const [navActions, setNavActions] = useState<React.ReactNode>(null);
  const [sessionsDrawerOpen, setSessionsDrawerOpen] = useState(false);
  const [workbenchDrawerOpen, setWorkbenchDrawerOpen] = useState(true);
  const [workspaceRunIds, setWorkspaceRunIds] = useState<{
    testRunId: string | null;
    gradeRunId: string | null;
  }>({
    testRunId: null,
    gradeRunId: null,
  });
  const workspacesApi = useWorkspaces();
  const [testBotResetToken, setTestBotResetToken] = useState(0);
  const pathRoute = getWorkspaceRouteFromPath(path);
  const livePath = window.location.pathname.replace(/\/+$/, "") || "/";
  const liveRoute = getWorkspaceRouteFromPath(livePath);
  const routeState = liveRoute ?? pathRoute;
  const routeRequestsNewWorkspace = Boolean(routeState?.isNew);
  const activeWorkspaceId = routeRequestsNewWorkspace
    ? null
    : routeState?.workspaceId ?? workspaceIdFromWindow;
  const requestedTestRunId = routeState?.tab === "test"
    ? routeState.testRunId ?? null
    : null;
  const requestedGradeRunId = routeState?.tab === "grade"
    ? routeState.gradeRunId ?? null
    : null;
  const lastWorkspaceIdRef = useRef<string | null>(null);
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
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const workspaceInitRef = useRef(false);

  useEffect(() => {
    if (activeWorkspaceId) {
      lastWorkspaceIdRef.current = activeWorkspaceId;
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    const syncPath = () => setPath(normalizeAppPath(window.location.pathname));
    const historyObj = window.history as History & {
      pushState: History["pushState"];
      replaceState: History["replaceState"];
    };
    const originalPushState = historyObj.pushState.bind(historyObj);
    const originalReplaceState = historyObj.replaceState.bind(historyObj);
    historyObj.pushState = (...args) => {
      originalPushState(...args);
      window.dispatchEvent(new Event("locationchange"));
    };
    historyObj.replaceState = (...args) => {
      originalReplaceState(...args);
      window.dispatchEvent(new Event("locationchange"));
    };
    window.addEventListener("popstate", syncPath);
    window.addEventListener("locationchange", syncPath);
    return () => {
      historyObj.pushState = originalPushState;
      historyObj.replaceState = originalReplaceState;
      window.removeEventListener("popstate", syncPath);
      window.removeEventListener("locationchange", syncPath);
    };
  }, []);

  const loadWorkbenchSessionDetail = useCallback(async (sessionId: string) => {
    const requestId = ++workbenchSessionDetailRequestRef.current;
    const shouldApply = () =>
      requestId === workbenchSessionDetailRequestRef.current &&
      activeWorkspaceIdRef.current === sessionId;
    try {
      setWorkbenchSessionDetailLoading(true);
      setWorkbenchSessionDetailError(null);
      const res = await fetch(
        `${WORKSPACES_API_BASE}/${encodeURIComponent(sessionId)}`,
      );
      if (!res.ok) {
        if (!shouldApply()) return;
        if (res.status === 404) {
          const attempts = workbenchSessionRetryRef.current[sessionId] ?? 0;
          if (attempts < 5) {
            workbenchSessionRetryRef.current[sessionId] = attempts + 1;
            setWorkbenchSessionDetailLoading(false);
            setWorkbenchSessionDetailError(null);
            window.setTimeout(() => {
              if (
                workbenchSessionDetailRequestRef.current === requestId &&
                activeWorkspaceIdRef.current === sessionId
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
      const detailEnvelope = await res.json().catch(() => null) as {
        session?: SessionDetailResponse;
      } | null;
      const detail = detailEnvelope?.session ?? null;
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
    if (!activeWorkspaceId) return;
    if (workbenchRefreshTimeoutRef.current) {
      window.clearTimeout(workbenchRefreshTimeoutRef.current);
    }
    const sessionId = activeWorkspaceId;
    workbenchRefreshTimeoutRef.current = window.setTimeout(() => {
      if (activeWorkspaceIdRef.current !== sessionId) return;
      loadWorkbenchSessionDetail(sessionId).catch(() => {});
    }, 900);
  }, [activeWorkspaceId, loadWorkbenchSessionDetail]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
    if (workbenchRefreshTimeoutRef.current) {
      window.clearTimeout(workbenchRefreshTimeoutRef.current);
      workbenchRefreshTimeoutRef.current = null;
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    return () => {
      if (workbenchRefreshTimeoutRef.current) {
        window.clearTimeout(workbenchRefreshTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setWorkbenchSessionDetail(null);
      setWorkbenchSessionDetailError(null);
      setWorkbenchSessionDetailLoading(false);
      return;
    }
    loadWorkbenchSessionDetail(activeWorkspaceId).catch(() => {});
  }, [activeWorkspaceId, loadWorkbenchSessionDetail]);

  const handleFeedbackPersisted = useCallback((workspaceId: string) => {
    if (!workspaceId) return;
    if (activeWorkspaceIdRef.current !== workspaceId) return;
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
  }, []);

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
  const handleReplaceTestBotSession = useCallback(
    (workspaceId: string, runId?: string) =>
      replacePath(buildTestPath(workspaceId, runId)),
    [replacePath],
  );
  const handleResetTestBotSession = useCallback(
    () => replacePath(buildTestPath(activeWorkspaceId ?? undefined)),
    [activeWorkspaceId, replacePath],
  );

  const handleWorkspaceChange = useCallback(
    (workspaceId: string) => {
      replacePath(buildWorkspacePath("build", workspaceId));
    },
    [replacePath],
  );

  useEffect(() => {
    if (!buildTabEnabled && path === "/build") {
      replacePath(DOCS_PATH);
    }
  }, [path, replacePath]);

  const isDocs = path === DOCS_PATH;
  const routeTab = liveRoute?.tab ?? pathRoute?.tab;
  const isBuild = buildTabEnabled &&
    (routeTab === "build" || path === "/build");
  const isTestBot = !isDocs &&
    (routeTab === "test" || /\/test$/.test(path));
  const isGrade = !isDocs &&
    routeTab === "grade";
  const currentPage = isDocs
    ? "docs"
    : isBuild
    ? "build"
    : isTestBot
    ? "test"
    : isGrade
    ? "grade"
    : "debug";

  useEffect(() => {
    if (activeWorkspaceId || lastWorkspaceIdRef.current) return;
    if (!routeRequestsNewWorkspace) return;
    if (workspaceInitRef.current) return;
    if (
      currentPage !== "build" && currentPage !== "test" &&
      currentPage !== "grade"
    ) {
      return;
    }
    workspaceInitRef.current = true;
    fetch(`${WORKSPACE_API_BASE}/new`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({})) as {
          workspaceId?: string;
        };
        if (!res.ok || typeof data.workspaceId !== "string") return;
        const nextPath = currentPage === "test"
          ? buildWorkspacePath("test", data.workspaceId)
          : currentPage === "grade"
          ? buildGradePath(data.workspaceId)
          : buildWorkspacePath("build", data.workspaceId);
        replacePath(nextPath);
      })
      .finally(() => {
        workspaceInitRef.current = false;
      });
  }, [activeWorkspaceId, currentPage, replacePath, routeRequestsNewWorkspace]);
  const resolveNavWorkspaceId = useCallback(() => {
    const normalizedPath = (window.location.pathname || "/").replace(
      /\/+$/,
      "",
    ) || "/";
    const directMatch = normalizedPath.match(
      /^\/workspaces\/([^/]+)\/(?:debug|build|test|grade)(?:\/[^/]+)?$/,
    );
    if (directMatch?.[1] && directMatch[1] !== "new") {
      return decodeURIComponent(directMatch[1]);
    }
    return getWorkspaceRouteFromPath(normalizedPath)?.workspaceId ??
      getWorkspaceIdFromPath(window.location.pathname) ??
      activeWorkspaceId ??
      lastWorkspaceIdRef.current;
  }, [activeWorkspaceId]);
  const resolveNavPath = useCallback((next: string) => {
    if (next === "docs") return DOCS_PATH;
    const workspaceId = resolveNavWorkspaceId();
    if (next === "build") return buildWorkspacePath("build", workspaceId);
    if (next === "test") {
      return buildTestPath(workspaceId, workspaceRunIds.testRunId ?? undefined);
    }
    if (next === "grade") {
      return workspaceId
        ? buildGradePath(workspaceId, workspaceRunIds.gradeRunId ?? undefined)
        : DEFAULT_GRADE_PATH;
    }
    return buildWorkspacePath("debug", workspaceId);
  }, [
    resolveNavWorkspaceId,
    workspaceRunIds.gradeRunId,
    workspaceRunIds.testRunId,
  ]);
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const nextPath = currentPage === "test" || currentPage === "docs"
        ? buildWorkspacePath("test", sessionId)
        : currentPage === "grade"
        ? buildGradePath(sessionId)
        : currentPage === "build"
        ? buildWorkspacePath("build", sessionId)
        : buildWorkspacePath("debug", sessionId);
      navigate(nextPath);
      setSessionsDrawerOpen(false);
    },
    [currentPage, navigate],
  );

  useEffect(() => {
    if (sessionsDrawerOpen) {
      workspacesApi.refresh();
    }
  }, [workspacesApi.refresh, sessionsDrawerOpen]);

  const deckSessions = useMemo(() => {
    if (workspaceIdFromWindow) {
      return workspacesApi.workspaces;
    }
    return workspacesApi.workspaces.filter((session) => {
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
    workspacesApi.workspaces,
    deckDisplayPath,
    normalizedDeckPath,
    repoRootPath,
    workspaceIdFromWindow,
  ]);

  const handleDeleteAll = useCallback(async () => {
    await workspacesApi.deleteAll(deckSessions);
    setTestBotResetToken((prev) => prev + 1);
    setSessionsDrawerOpen(false);
    window.location.assign(DEFAULT_TEST_PATH);
  }, [deckSessions, workspacesApi.deleteAll]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await workspacesApi.deleteWorkspace(sessionId);
      if (sessionId === activeWorkspaceId) {
        window.location.assign(DEFAULT_TEST_PATH);
      }
    },
    [activeWorkspaceId, workspacesApi.deleteWorkspace],
  );

  return (
    <WorkspaceProvider
      workspaceId={activeWorkspaceId}
      onWorkspaceChange={handleWorkspaceChange}
      requestedTestRunId={routeState?.tab === "test"
        ? requestedTestRunId
        : undefined}
      requestedGradeRunId={routeState?.tab === "grade"
        ? requestedGradeRunId
        : undefined}
      onRoutingStateChange={setWorkspaceRunIds}
    >
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
                onChange={(next) => navigate(resolveNavPath(next))}
                tabs={[
                  {
                    id: "docs",
                    label: "Docs",
                    testId: "nav-docs",
                    href: resolveNavPath("docs"),
                  },
                  ...(buildTabEnabled
                    ? [{
                      id: "build",
                      label: "Build",
                      testId: "nav-build",
                      href: resolveNavPath("build"),
                    }]
                    : []),
                  {
                    id: "test",
                    label: "Test",
                    testId: "nav-test",
                    href: resolveNavPath("test"),
                  },
                  {
                    id: "grade",
                    label: "Grade",
                    testId: "nav-grade",
                    href: resolveNavPath("grade"),
                  },
                  {
                    id: "debug",
                    label: "Debug",
                    testId: "nav-debug",
                    href: resolveNavPath("debug"),
                  },
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
                    onClick={() => setWorkbenchDrawerOpen((prev) => !prev)}
                    aria-label={workbenchDrawerOpen
                      ? "Close workbench drawer"
                      : "Open workbench drawer"}
                    data-testid="nav-workbench"
                  >
                    <Icon
                      name="chat"
                      size={16}
                      style={{ color: "currentColor" }}
                    />
                  </Button>
                </div>
              </div>
            </div>
            <div className="app-content-frame">
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
                      workspacesApi={workspacesApi}
                      onOpenSessionsDrawer={() => setSessionsDrawerOpen(true)}
                      activeWorkspaceId={activeWorkspaceId}
                    />
                  )
                  : currentPage === "test"
                  ? (
                    <TestBotPage
                      onReplaceTestBotSession={handleReplaceTestBotSession}
                      onResetTestBotSession={handleResetTestBotSession}
                      activeWorkspaceId={activeWorkspaceId}
                      requestedRunId={requestedTestRunId}
                      resetToken={testBotResetToken}
                      setNavActions={setNavActions}
                      onFeedbackPersisted={handleFeedbackPersisted}
                    />
                  )
                  : (
                    <GradePage
                      setNavActions={setNavActions}
                      onAppPathChange={handleAppPathChange}
                      activeWorkspaceId={activeWorkspaceId}
                      requestedGradeRunId={requestedGradeRunId}
                      onFlagsUpdate={applyFlagsUpdate}
                      onOptimisticToggleFlag={optimisticToggleFlag}
                      onOptimisticFlagReason={optimisticFlagReason}
                    />
                  )}
              </div>
              {workbenchDrawerOpen && (
                <WorkbenchDrawer
                  open={workbenchDrawerOpen}
                  onClose={() => setWorkbenchDrawerOpen(false)}
                  loading={workbenchSessionDetailLoading}
                  error={workbenchSessionDetailError}
                  sessionId={activeWorkspaceId}
                  sessionDetail={workbenchSessionDetail}
                />
              )}
            </div>
          </div>
        </div>
        <AppDrawer
          open={sessionsDrawerOpen}
          workspaces={deckSessions}
          loading={workspacesApi.loading}
          error={workspacesApi.error}
          onRefresh={workspacesApi.refresh}
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
          onDeleteAll={handleDeleteAll}
          onClose={() => setSessionsDrawerOpen(false)}
          activeWorkspaceId={activeWorkspaceId}
          bundleStamp={bundleStamp}
        />
      </>
    </WorkspaceProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
