import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  WORKSPACE_API_BASE,
  WORKSPACES_API_BASE,
} from "../../src/workspace_contract.ts";
import {
  buildDurableStreamUrl,
  type CalibrateResponse,
  type CalibrateSession,
  type CalibrateStreamMessage,
  type CalibrationRun,
  deriveBuildDisplayMessages,
  type FeedbackEntry,
  getDurableStreamOffset,
  type GraderDeckMeta,
  type GradingFlag,
  type SessionDetailResponse,
  setDurableStreamOffset,
  summarizeToolCalls,
  type TestBotConfigResponse,
  type TestBotRun,
  type ToolCallSummary,
  type TraceEvent,
  WORKSPACE_STREAM_ID,
  type WorkspaceSocketMessage,
} from "./utils.ts";

export type BuildRun = {
  id: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  displayMessages?: Array<{
    kind: "message" | "tool" | "reasoning";
    role?: "user" | "assistant";
    content?: string;
    toolCallId?: string;
    toolSummary?: ToolCallSummary;
    reasoningId?: string;
    reasoningRaw?: Record<string, unknown>;
  }>;
  traces?: Array<TraceEvent>;
  toolInserts?: Array<{
    actionCallId?: string;
    parentActionCallId?: string;
    name?: string;
    index: number;
  }>;
};

type WorkspaceBuildState = {
  run: BuildRun;
  toolCalls: ToolCallSummary[];
  chatDraft: string;
  setChatDraft: React.Dispatch<React.SetStateAction<string>>;
  chatSending: boolean;
  chatError: string | null;
  setChatError: React.Dispatch<React.SetStateAction<string | null>>;
  toolCallsOpen: Record<string, boolean>;
  setToolCallsOpen: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  optimisticUser: { id: string; text: string } | null;
  setOptimisticUser: React.Dispatch<
    React.SetStateAction<{ id: string; text: string } | null>
  >;
  streamingAssistant: { runId: string; turn: number; text: string } | null;
  setStreamingAssistant: React.Dispatch<
    React.SetStateAction<
      { runId: string; turn: number; text: string } | null
    >
  >;
  stopChat: () => Promise<void>;
  resetChat: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  loadChat: (runId: string) => Promise<void>;
};

type WorkspaceTestState = {
  run: TestBotRun;
  setRun: React.Dispatch<React.SetStateAction<TestBotRun>>;
  streamingUser: {
    runId: string;
    turn: number;
    text: string;
    expectedUserCount?: number;
  } | null;
  streamingAssistant: { runId: string; turn: number; text: string } | null;
  chatDraft: string;
  setChatDraft: React.Dispatch<React.SetStateAction<string>>;
  chatSending: boolean;
  chatError: string | null;
  setChatError: React.Dispatch<React.SetStateAction<string | null>>;
  optimisticUser: { id: string; text: string } | null;
  refreshStatus: (
    opts?: { runId?: string; workspaceId?: string; deckPath?: string },
  ) => Promise<TestBotRun>;
  startRun: (
    payload: Record<string, unknown>,
  ) => Promise<{ run?: TestBotRun; error?: string; initFill?: unknown }>;
  startAssistant: (
    payload: {
      runId?: string;
      workspaceId?: string;
      runWorkspaceId?: string;
      botDeckPath?: string;
      context?: unknown;
    },
  ) => Promise<void>;
  sendMessage: (
    message: string,
    payload: {
      runId?: string;
      workspaceId?: string;
      runWorkspaceId?: string;
      botDeckPath?: string;
      context?: unknown;
    },
  ) => Promise<void>;
  stopRun: (runId: string) => Promise<void>;
  resetRun: () => void;
  saveFeedback: (
    payload: {
      workspaceId: string;
      runId?: string;
      messageRefId: string;
      score: number | null;
      reason?: string;
    },
  ) => Promise<{ feedback?: FeedbackEntry; deleted?: boolean }>;
};

type WorkspaceGradeState = {
  loading: boolean;
  error: string | null;
  running: boolean;
  graders: GraderDeckMeta[];
  sessions: CalibrateSession[];
  sessionDetail: SessionDetailResponse | null;
  loadData: (
    opts?: { workspaceId?: string | null; gradeRunId?: string | null },
  ) => Promise<void>;
  loadSessionDetail: (workspaceId: string | null) => Promise<void>;
  runGrader: (
    payload: { workspaceId: string; graderId: string; scenarioRunId?: string },
  ) => Promise<{ session?: CalibrateSession; run?: CalibrationRun }>;
  toggleFlag: (
    payload: {
      workspaceId: string;
      refId: string;
      runId: string;
      turnIndex?: number;
    },
  ) => Promise<{ flags?: GradingFlag[] }>;
  updateFlagReason: (
    payload: { workspaceId: string; refId: string; reason: string },
  ) => Promise<{ flags?: GradingFlag[] }>;
};

type WorkspaceContextValue = {
  build: WorkspaceBuildState;
  test: WorkspaceTestState;
  grade: WorkspaceGradeState;
  routing: {
    testRunId: string | null;
    gradeRunId: string | null;
    setTestRunId: (runId: string | null) => void;
    setGradeRunId: (runId: string | null) => void;
  };
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function isGradeDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const fromQuery = new URLSearchParams(window.location.search).get(
    "gradeDebug",
  );
  if (fromQuery === "1" || fromQuery === "true") return true;
  try {
    const fromStorage = window.localStorage.getItem("gambit.gradeDebug");
    return fromStorage === "1" || fromStorage === "true";
  } catch {
    return false;
  }
}

function gradeDebugLog(event: string, payload?: Record<string, unknown>) {
  if (!isGradeDebugEnabled()) return;
  const ts = new Date().toISOString();
  if (payload && Object.keys(payload).length > 0) {
    console.log(`[grade-debug] ${ts} ${event}`, payload);
    return;
  }
  console.log(`[grade-debug] ${ts} ${event}`);
}

const normalizeTestRun = (run?: TestBotRun): TestBotRun => {
  if (!run) {
    return {
      status: "idle",
      messages: [],
      traces: [],
      toolInserts: [],
    };
  }
  const workspaceId = typeof run.workspaceId === "string"
    ? run.workspaceId
    : typeof run.sessionId === "string"
    ? run.sessionId
    : undefined;
  return {
    ...run,
    workspaceId,
    sessionId: workspaceId,
    messages: run.messages ?? [],
    traces: run.traces ?? [],
    toolInserts: run.toolInserts ?? [],
  };
};

export function WorkspaceProvider(
  props: {
    children: React.ReactNode;
    workspaceId?: string | null;
    onWorkspaceChange?: (workspaceId: string) => void;
    requestedTestRunId?: string | null;
    requestedGradeRunId?: string | null;
    onRoutingStateChange?: (state: {
      testRunId: string | null;
      gradeRunId: string | null;
    }) => void;
  },
) {
  const {
    children,
    workspaceId,
    onWorkspaceChange,
    requestedTestRunId,
    requestedGradeRunId,
    onRoutingStateChange,
  } = props;
  const [buildRun, setBuildRun] = useState<BuildRun>({
    id: "",
    status: "idle",
    messages: [],
    traces: [],
    toolInserts: [],
  });
  const buildRunRef = useRef<BuildRun>({
    id: "",
    status: "idle",
    messages: [],
    traces: [],
    toolInserts: [],
  });
  const buildRunIdRef = useRef<string>("");
  const buildIgnoredStreamRunIdsRef = useRef<Set<string>>(new Set());

  const [buildChatDraft, setBuildChatDraft] = useState("");
  const [buildChatSending, setBuildChatSending] = useState(false);
  const [buildChatError, setBuildChatError] = useState<string | null>(null);
  const [buildToolCallsOpen, setBuildToolCallsOpen] = useState<
    Record<string, boolean>
  >({});
  const [buildOptimisticUser, setBuildOptimisticUser] = useState<
    { id: string; text: string } | null
  >(null);
  const [buildStreamingAssistant, setBuildStreamingAssistant] = useState<
    { runId: string; turn: number; text: string } | null
  >(null);
  const pendingBuildTracesRef = useRef<TraceEvent[]>([]);
  const pendingBuildTraceRunIdRef = useRef<string | null>(null);
  const buildTraceFlushHandleRef = useRef<number | null>(null);
  const buildTraceFlushModeRef = useRef<"raf" | "timeout" | null>(null);

  const [testRun, setTestRun] = useState<TestBotRun>(() => normalizeTestRun());
  const [activeTestRunId, setActiveTestRunId] = useState<string | null>(null);
  const [activeGradeRunId, setActiveGradeRunId] = useState<string | null>(null);
  const testRunIdRef = useRef<string>("");
  const testRunRef = useRef<TestBotRun>(normalizeTestRun());
  const [testStreamingUser, setTestStreamingUser] = useState<
    {
      runId: string;
      turn: number;
      text: string;
      expectedUserCount?: number;
    } | null
  >(null);
  const [testStreamingAssistant, setTestStreamingAssistant] = useState<
    { runId: string; turn: number; text: string } | null
  >(null);
  const [testChatDraft, setTestChatDraft] = useState("");
  const [testChatSending, setTestChatSending] = useState(false);
  const [testChatError, setTestChatError] = useState<string | null>(null);
  const [testOptimisticUser, setTestOptimisticUser] = useState<
    { id: string; text: string } | null
  >(null);

  const [gradeLoading, setGradeLoading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [gradeRunning, setGradeRunning] = useState(false);
  const [gradeGraders, setGradeGraders] = useState<GraderDeckMeta[]>([]);
  const [gradeSessions, setGradeSessions] = useState<CalibrateSession[]>([]);
  const [gradeSessionDetail, setGradeSessionDetail] = useState<
    SessionDetailResponse | null
  >(null);

  const buildDisplayMessages = useCallback(
    (run: BuildRun): BuildRun["displayMessages"] => {
      return deriveBuildDisplayMessages(run.messages, run.traces ?? []);
    },
    [],
  );
  const normalizeBuildRun = useCallback((run: BuildRun): BuildRun => {
    return {
      ...run,
      messages: Array.isArray(run.messages) ? run.messages : [],
      traces: Array.isArray(run.traces) ? run.traces : [],
      toolInserts: Array.isArray(run.toolInserts) ? run.toolInserts : [],
    };
  }, []);

  const mergeBuildRunSnapshot = useCallback(
    (prev: BuildRun, incomingRun: BuildRun): BuildRun => {
      const incoming = normalizeBuildRun(incomingRun);
      const sameRun = Boolean(prev.id) && prev.id === incoming.id;
      const preserveStreamingArrays = sameRun &&
        prev.status === "running" &&
        incoming.status === "running";
      const incomingMessages = incoming.messages ?? [];
      const incomingTraces = incoming.traces ?? [];
      const incomingToolInserts = incoming.toolInserts ?? [];

      const nextRun: BuildRun = {
        ...incoming,
        messages: preserveStreamingArrays &&
            incomingMessages.length < (prev.messages?.length ?? 0)
          ? (prev.messages ?? [])
          : incomingMessages,
        traces: preserveStreamingArrays &&
            incomingTraces.length < (prev.traces?.length ?? 0)
          ? (prev.traces ?? [])
          : incomingTraces,
        toolInserts: preserveStreamingArrays &&
            incomingToolInserts.length < (prev.toolInserts?.length ?? 0)
          ? (prev.toolInserts ?? [])
          : incomingToolInserts,
      };
      nextRun.displayMessages = buildDisplayMessages(nextRun);
      return nextRun;
    },
    [buildDisplayMessages, normalizeBuildRun],
  );
  const cancelBuildTraceFlush = useCallback(() => {
    const handle = buildTraceFlushHandleRef.current;
    const mode = buildTraceFlushModeRef.current;
    if (handle === null || mode === null) return;
    if (
      mode === "raf" && typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(handle);
    } else if (mode === "timeout") {
      clearTimeout(handle);
    }
    buildTraceFlushHandleRef.current = null;
    buildTraceFlushModeRef.current = null;
  }, []);
  const flushPendingBuildTraces = useCallback(() => {
    const pending = pendingBuildTracesRef.current;
    const pendingRunId = pendingBuildTraceRunIdRef.current;
    if (pending.length === 0) return;
    pendingBuildTracesRef.current = [];
    pendingBuildTraceRunIdRef.current = null;
    setBuildRun((prev) => {
      if (pendingRunId && prev.id && prev.id !== pendingRunId) {
        return prev;
      }
      const traces = Array.isArray(prev.traces)
        ? [...prev.traces, ...pending]
        : [
          ...pending,
        ];
      const nextRun = { ...prev, traces } as BuildRun;
      nextRun.displayMessages = buildDisplayMessages(nextRun);
      return nextRun;
    });
  }, [buildDisplayMessages]);
  const scheduleBuildTraceFlush = useCallback(() => {
    if (buildTraceFlushHandleRef.current !== null) return;
    const flush = () => {
      buildTraceFlushHandleRef.current = null;
      buildTraceFlushModeRef.current = null;
      flushPendingBuildTraces();
    };
    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      buildTraceFlushModeRef.current = "raf";
      buildTraceFlushHandleRef.current = window.requestAnimationFrame(flush);
      return;
    }
    buildTraceFlushModeRef.current = "timeout";
    buildTraceFlushHandleRef.current = setTimeout(flush, 16);
  }, [flushPendingBuildTraces]);
  const clearPendingBuildTraces = useCallback(() => {
    cancelBuildTraceFlush();
    pendingBuildTracesRef.current = [];
    pendingBuildTraceRunIdRef.current = null;
  }, [cancelBuildTraceFlush]);
  const gradeLoadSeqRef = useRef(0);
  const gradeDetailSeqRef = useRef(0);
  const loadWorkspaceSnapshot = useCallback(async (
    targetWorkspaceId: string,
    opts?: { deckPath?: string; testRunId?: string; gradeRunId?: string },
  ) => {
    const params = new URLSearchParams();
    if (opts?.deckPath) params.set("deckPath", opts.deckPath);
    const query = params.toString() ? `?${params.toString()}` : "";
    const endpoint = opts?.testRunId
      ? `${WORKSPACES_API_BASE}/${encodeURIComponent(targetWorkspaceId)}/test/${
        encodeURIComponent(opts.testRunId)
      }${query}`
      : opts?.gradeRunId
      ? `${WORKSPACES_API_BASE}/${
        encodeURIComponent(targetWorkspaceId)
      }/grade/${encodeURIComponent(opts.gradeRunId)}${query}`
      : `${WORKSPACES_API_BASE}/${
        encodeURIComponent(targetWorkspaceId)
      }${query}`;
    const res = await fetch(
      endpoint,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || res.statusText);
    }
    return await res.json() as {
      workspaceId: string;
      build: { run?: BuildRun };
      test: TestBotConfigResponse & { run?: TestBotRun };
      grade: CalibrateResponse;
      session: SessionDetailResponse;
    };
  }, []);

  const refreshBuildStatus = useCallback(
    async (opts?: { workspaceId?: string }) => {
      if (opts?.workspaceId) {
        const data = await loadWorkspaceSnapshot(opts.workspaceId);
        if (!data.build.run) return;
        setBuildRun((prev) =>
          mergeBuildRunSnapshot(prev, data.build.run as BuildRun)
        );
        if (typeof data.build.run.id === "string" && data.build.run.id) {
          buildRunIdRef.current = data.build.run.id;
        }
        return;
      }
      buildRunIdRef.current = "";
      setBuildRun({
        id: "",
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
        displayMessages: [],
      });
    },
    [loadWorkspaceSnapshot, mergeBuildRunSnapshot],
  );

  useEffect(() => {
    buildRunRef.current = buildRun;
  }, [buildRun]);

  useEffect(() => {
    if (workspaceId) {
      buildRunIdRef.current = workspaceId;
      refreshBuildStatus({ workspaceId }).catch(() => {});
      return;
    }
    refreshBuildStatus().catch(() => {});
  }, [refreshBuildStatus, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    if (buildRunIdRef.current === workspaceId) return;
    buildRunIdRef.current = workspaceId;
    setBuildRun((prev) => ({
      ...prev,
      id: workspaceId,
    }));
    setBuildChatError(null);
    setBuildStreamingAssistant(null);
    setBuildOptimisticUser(null);
    setBuildToolCallsOpen({});
    clearPendingBuildTraces();
    refreshBuildStatus({ workspaceId }).catch(() => {});
  }, [clearPendingBuildTraces, refreshBuildStatus, workspaceId]);

  useEffect(() => {
    testRunRef.current = testRun;
    if (typeof testRun.id === "string" && testRun.id) {
      testRunIdRef.current = testRun.id;
      setActiveTestRunId(testRun.id);
    }
  }, [testRun]);

  useEffect(() => {
    if (requestedTestRunId === undefined) return;
    setActiveTestRunId(requestedTestRunId);
  }, [requestedTestRunId]);

  useEffect(() => {
    if (requestedGradeRunId === undefined) return;
    setActiveGradeRunId(requestedGradeRunId);
  }, [requestedGradeRunId]);

  useEffect(() => {
    onRoutingStateChange?.({
      testRunId: activeTestRunId,
      gradeRunId: activeGradeRunId,
    });
  }, [activeGradeRunId, activeTestRunId, onRoutingStateChange]);

  useEffect(() => {
    const streamId = WORKSPACE_STREAM_ID;
    const streamUrl = buildDurableStreamUrl(
      streamId,
      getDurableStreamOffset(streamId),
    );
    const source = new EventSource(streamUrl);

    const handleMessage = (event: MessageEvent<string>) => {
      let msg: WorkspaceSocketMessage | null = null;
      try {
        msg = JSON.parse(event.data) as WorkspaceSocketMessage;
      } catch {
        return;
      }
      const parsedOffset = Number(event.lastEventId);
      if (Number.isFinite(parsedOffset)) {
        setDurableStreamOffset(streamId, parsedOffset + 1);
      }
      if (!msg) return;
      if (msg.type === "buildBotStatus" && msg.run) {
        const activeBuildRunId = buildRunIdRef.current;
        if (activeBuildRunId && msg.run.id !== activeBuildRunId) return;
        if (
          msg.run.id &&
          msg.run.status === "running" &&
          buildIgnoredStreamRunIdsRef.current.has(msg.run.id)
        ) {
          return;
        }
        flushPendingBuildTraces();
        setBuildRun((prev) => mergeBuildRunSnapshot(prev, msg.run as BuildRun));
        if (msg.run.status !== "running") {
          setBuildStreamingAssistant(null);
        }
        return;
      }
      if (msg.type === "buildBotTrace") {
        const activeBuildRunId = buildRunIdRef.current;
        if (activeBuildRunId && msg.runId && msg.runId !== activeBuildRunId) {
          return;
        }
        if (!msg.event) return;
        const traceRunId = typeof msg.runId === "string" && msg.runId.length > 0
          ? msg.runId
          : (buildRunIdRef.current || null);
        const pendingRunId = pendingBuildTraceRunIdRef.current;
        if (pendingRunId && traceRunId && pendingRunId !== traceRunId) {
          clearPendingBuildTraces();
        }
        if (!pendingBuildTraceRunIdRef.current && traceRunId) {
          pendingBuildTraceRunIdRef.current = traceRunId;
        }
        pendingBuildTracesRef.current.push(msg.event);
        scheduleBuildTraceFlush();
        return;
      }
      if (msg.type === "buildBotStream") {
        const activeBuildRunId = buildRunIdRef.current;
        if (
          !msg.runId ||
          (activeBuildRunId && msg.runId !== activeBuildRunId) ||
          buildIgnoredStreamRunIdsRef.current.has(msg.runId) ||
          msg.role !== "assistant"
        ) {
          return;
        }
        const streamRunId = msg.runId;
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        setBuildStreamingAssistant((prev) =>
          prev && prev.runId === streamRunId && prev.turn === turn
            ? { ...prev, text: prev.text + msg.chunk }
            : { runId: streamRunId, turn, text: msg.chunk }
        );
        return;
      }
      if (msg.type === "buildBotStreamEnd") {
        const activeBuildRunId = buildRunIdRef.current;
        if (
          !msg.runId ||
          (activeBuildRunId && msg.runId !== activeBuildRunId) ||
          buildIgnoredStreamRunIdsRef.current.has(msg.runId)
        ) {
          return;
        }
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        setBuildStreamingAssistant((prev) =>
          prev && prev.runId === msg.runId && prev.turn === turn ? null : prev
        );
        return;
      }
      if (msg.type === "testBotStatus" && msg.run) {
        const activeTestRunId = testRunIdRef.current;
        if (activeTestRunId && msg.run.id !== activeTestRunId) return;
        const normalized = normalizeTestRun(msg.run);
        if (normalized.status !== "running") {
          setTestStreamingUser(null);
          setTestStreamingAssistant(null);
        }
        setTestStreamingUser((prev) => {
          if (
            !prev ||
            prev.runId !== normalized.id ||
            prev.expectedUserCount === undefined
          ) {
            return prev;
          }
          const userCount = (normalized.messages ?? []).filter((entry) =>
            entry.role === "user"
          ).length;
          return userCount >= prev.expectedUserCount ? null : prev;
        });
        setTestStreamingAssistant((prev) => {
          if (
            !prev ||
            prev.runId !== normalized.id ||
            !prev.text ||
            !Array.isArray(normalized.messages)
          ) {
            return prev;
          }
          const hasAssistant = normalized.messages.some((entry) =>
            entry.role === "assistant" &&
            typeof entry.content === "string" &&
            entry.content.includes(prev.text)
          );
          return hasAssistant ? null : prev;
        });
        setTestRun(normalized);
        if (typeof normalized.id === "string" && normalized.id) {
          testRunIdRef.current = normalized.id;
        }
        return;
      }
      if (msg.type === "testBotStream") {
        const activeTestRunId = testRunIdRef.current;
        if (!msg.runId || (activeTestRunId && msg.runId !== activeTestRunId)) {
          return;
        }
        const streamRunId = msg.runId;
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        if (msg.role === "assistant") {
          setTestStreamingAssistant((prev) =>
            prev && prev.runId === streamRunId && prev.turn === turn
              ? { ...prev, text: prev.text + msg.chunk }
              : { runId: streamRunId, turn, text: msg.chunk }
          );
          return;
        }
        if (msg.role === "user") {
          setTestStreamingUser((prev) =>
            prev && prev.runId === streamRunId && prev.turn === turn
              ? { ...prev, text: prev.text + msg.chunk }
              : { runId: streamRunId, turn, text: msg.chunk }
          );
        }
        return;
      }
      if (msg.type === "testBotStreamEnd") {
        const activeTestRunId = testRunIdRef.current;
        if (!msg.runId || (activeTestRunId && msg.runId !== activeTestRunId)) {
          return;
        }
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        if (msg.role === "assistant") {
          setTestStreamingAssistant((prev) =>
            prev && prev.runId === msg.runId && prev.turn === turn ? null : prev
          );
          return;
        }
        if (msg.role === "user") {
          const expectedUserCount =
            (testRunRef.current.messages ?? []).filter((entry) =>
              entry.role === "user"
            ).length + 1;
          setTestStreamingUser((prev) =>
            prev && prev.runId === msg.runId && prev.turn === turn
              ? { ...prev, expectedUserCount }
              : prev
          );
        }
        return;
      }
      const gradeMsg = msg as CalibrateStreamMessage;
      if (gradeMsg.type !== "calibrateSession") return;
      gradeDebugLog("stream.calibrateSession", {
        sessionId: gradeMsg.session.id,
        runCount: gradeMsg.session.gradingRuns?.length ?? 0,
      });
      setGradeSessions((prev) => {
        const next = [...prev];
        const index = next.findIndex((sess) => sess.id === gradeMsg.session.id);
        if (index >= 0) {
          next[index] = gradeMsg.session;
          return next;
        }
        return [gradeMsg.session, ...next];
      });
    };

    const workspaceEventTypes = [
      "buildBotStatus",
      "buildBotTrace",
      "buildBotStream",
      "buildBotStreamEnd",
      "testBotStatus",
      "testBotStream",
      "testBotStreamEnd",
      "calibrateSession",
    ] as const;
    for (const type of workspaceEventTypes) {
      source.addEventListener(type, handleMessage as EventListener);
    }

    return () => {
      for (const type of workspaceEventTypes) {
        source.removeEventListener(type, handleMessage as EventListener);
      }
      source.close();
      clearPendingBuildTraces();
    };
  }, [
    clearPendingBuildTraces,
    flushPendingBuildTraces,
    mergeBuildRunSnapshot,
    scheduleBuildTraceFlush,
  ]);

  useEffect(() => {
    return () => {
      clearPendingBuildTraces();
    };
  }, [clearPendingBuildTraces]);

  const buildToolCalls = useMemo(
    () => summarizeToolCalls(buildRun.traces ?? []),
    [buildRun.traces],
  );

  const ensureWorkspaceId = useCallback(async () => {
    if (workspaceId) return workspaceId;
    if (buildRunIdRef.current) return buildRunIdRef.current;
    try {
      const res = await fetch(`${WORKSPACE_API_BASE}/new`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({})) as {
        workspaceId?: string;
      };
      if (res.ok && typeof data.workspaceId === "string") {
        const nextWorkspaceId = data.workspaceId;
        buildRunIdRef.current = nextWorkspaceId;
        setBuildRun((prev) => ({ ...prev, id: nextWorkspaceId }));
        onWorkspaceChange?.(nextWorkspaceId);
        return nextWorkspaceId;
      }
    } catch {
      // ignore
    }
    const fallback = `workspace-${crypto.randomUUID()}`;
    buildRunIdRef.current = fallback;
    setBuildRun((prev) => ({ ...prev, id: fallback }));
    return fallback;
  }, [onWorkspaceChange, workspaceId]);

  const resetBuildChat = useCallback(async () => {
    const res = await fetch(`${WORKSPACE_API_BASE}/new`, { method: "POST" })
      .catch(
        () => null,
      );
    const data = res
      ? await res.json().catch(() => ({})) as { workspaceId?: string }
      : {};
    if (res && res.ok && typeof data.workspaceId === "string") {
      buildRunIdRef.current = data.workspaceId;
      buildIgnoredStreamRunIdsRef.current.clear();
      setBuildRun({
        id: data.workspaceId,
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
        displayMessages: [],
      });
      onWorkspaceChange?.(data.workspaceId);
    } else {
      buildRunIdRef.current = "";
      buildIgnoredStreamRunIdsRef.current.clear();
      setBuildRun({
        id: "",
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
        displayMessages: [],
      });
    }
    setBuildChatDraft("");
    setBuildChatError(null);
    setBuildStreamingAssistant(null);
    setBuildOptimisticUser(null);
    setBuildToolCallsOpen({});
    clearPendingBuildTraces();
  }, [clearPendingBuildTraces, onWorkspaceChange]);

  const stopBuildChat = useCallback(async () => {
    const runId = buildRunRef.current.id || buildRunIdRef.current;
    if (!runId) return;
    const runSnapshotAtStop = buildRunRef.current;
    buildIgnoredStreamRunIdsRef.current.add(runId);
    setBuildStreamingAssistant(null);
    setBuildRun((prev) =>
      prev.id === runId && prev.status === "running"
        ? {
          ...prev,
          status: "canceled",
          finishedAt: prev.finishedAt ?? new Date().toISOString(),
          error: undefined,
        }
        : prev
    );
    try {
      const res = await fetch("/api/build/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: runId }),
      });
      const data = await res.json().catch(() => ({})) as {
        run?: BuildRun;
        error?: string;
        stopped?: boolean;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : res.statusText,
        );
      }
      if (data.stopped === false) {
        buildIgnoredStreamRunIdsRef.current.delete(runId);
        await refreshBuildStatus({ workspaceId: runId }).catch(() => {});
        return;
      }
      if (data.run && data.run.id !== runId) {
        buildIgnoredStreamRunIdsRef.current.delete(runId);
        await refreshBuildStatus({ workspaceId: runId }).catch(() => {});
        return;
      }
      if (data.run) {
        setBuildRun((prev) => {
          if (prev.id !== runId) return prev;
          const next = mergeBuildRunSnapshot(prev, data.run as BuildRun);
          if (
            runSnapshotAtStop.id === runId &&
            runSnapshotAtStop.status === "running"
          ) {
            next.status = "canceled";
            next.finishedAt = next.finishedAt ?? new Date().toISOString();
            next.error = undefined;
            if (
              Array.isArray(next.messages) &&
              Array.isArray(runSnapshotAtStop.messages) &&
              next.messages.length < runSnapshotAtStop.messages.length
            ) {
              next.messages = runSnapshotAtStop.messages;
            }
            if (
              Array.isArray(next.traces) &&
              Array.isArray(runSnapshotAtStop.traces) &&
              next.traces.length < runSnapshotAtStop.traces.length
            ) {
              next.traces = runSnapshotAtStop.traces;
            }
            if (
              Array.isArray(next.toolInserts) &&
              Array.isArray(runSnapshotAtStop.toolInserts) &&
              next.toolInserts.length < runSnapshotAtStop.toolInserts.length
            ) {
              next.toolInserts = runSnapshotAtStop.toolInserts;
            }
            next.displayMessages = buildDisplayMessages(next);
          }
          return next;
        });
      }
    } catch (err) {
      buildIgnoredStreamRunIdsRef.current.delete(runId);
      const isStillActiveRun = buildRunIdRef.current === runId &&
        buildRunRef.current.id === runId;
      if (isStillActiveRun) {
        await refreshBuildStatus({ workspaceId: runId }).catch(() => {});
      }
      throw err;
    }
  }, [buildDisplayMessages, mergeBuildRunSnapshot, refreshBuildStatus]);

  const sendBuildMessage = useCallback(async (message: string) => {
    const runId = await ensureWorkspaceId();
    buildIgnoredStreamRunIdsRef.current.delete(runId);
    setBuildChatSending(true);
    setBuildChatError(null);
    try {
      const res = await fetch("/api/build/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: runId, message }),
      });
      const data = await res.json().catch(() => ({})) as {
        run?: BuildRun;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : res.statusText,
        );
      }
      if (!data.run) return;
      setBuildRun((prev) => mergeBuildRunSnapshot(prev, data.run as BuildRun));
      if (typeof data.run.id === "string" && data.run.id) {
        buildRunIdRef.current = data.run.id;
      }
    } finally {
      setBuildChatSending(false);
    }
  }, [ensureWorkspaceId, mergeBuildRunSnapshot]);

  const loadBuildChat = useCallback(async (runId: string) => {
    setBuildChatSending(true);
    setBuildChatError(null);
    try {
      const snapshot = await loadWorkspaceSnapshot(runId);
      const data = snapshot.build;
      if (!data.run) return;
      buildIgnoredStreamRunIdsRef.current.delete(runId);
      setBuildRun((prev) => mergeBuildRunSnapshot(prev, data.run as BuildRun));
      if (typeof data.run.id === "string" && data.run.id) {
        buildRunIdRef.current = data.run.id;
        onWorkspaceChange?.(data.run.id);
      }
      setBuildChatDraft("");
      setBuildOptimisticUser(null);
      setBuildStreamingAssistant(null);
      setBuildToolCallsOpen({});
    } finally {
      setBuildChatSending(false);
    }
  }, [loadWorkspaceSnapshot, mergeBuildRunSnapshot, onWorkspaceChange]);

  const refreshTestStatus = useCallback(async (
    opts?: { runId?: string; workspaceId?: string; deckPath?: string },
  ) => {
    const resolvedWorkspaceId = opts?.workspaceId ??
      testRunRef.current.workspaceId ??
      testRunRef.current.sessionId ??
      workspaceId ??
      undefined;
    const resolvedRunId = opts?.runId ?? (testRunIdRef.current || undefined);
    if (resolvedWorkspaceId) {
      const snapshot = await loadWorkspaceSnapshot(resolvedWorkspaceId, {
        deckPath: opts?.deckPath,
        testRunId: resolvedRunId,
      });
      const data = snapshot.test;
      const normalized = normalizeTestRun(data.run);
      setTestRun(normalized);
      if (normalized.status !== "running") {
        setTestStreamingUser(null);
        setTestStreamingAssistant(null);
      }
      if (typeof normalized.id === "string" && normalized.id) {
        testRunIdRef.current = normalized.id;
      }
      return normalized;
    }
    const normalized = normalizeTestRun();
    setTestRun(normalized);
    testRunIdRef.current = resolvedRunId ?? "";
    setTestStreamingUser(null);
    setTestStreamingAssistant(null);
    return normalized;
  }, [loadWorkspaceSnapshot, workspaceId]);

  const startTestRun = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/test/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({})) as {
      run?: TestBotRun;
      error?: string;
      initFill?: unknown;
    };
    if (data.run) {
      const normalized = normalizeTestRun(data.run);
      setTestRun(normalized);
      if (typeof normalized.id === "string" && normalized.id) {
        testRunIdRef.current = normalized.id;
      }
    }
    return data;
  }, []);

  const sendTestMessageRequest = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/test/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({})) as {
        run?: TestBotRun;
        error?: string;
      };
      if (data.run) {
        const normalized = normalizeTestRun(data.run);
        setTestRun(normalized);
        if (typeof normalized.id === "string" && normalized.id) {
          testRunIdRef.current = normalized.id;
        }
      }
      return data;
    },
    [],
  );

  const startTestAssistant = useCallback(async (
    payload: {
      runId?: string;
      workspaceId?: string;
      runWorkspaceId?: string;
      botDeckPath?: string;
      context?: unknown;
    },
  ) => {
    setTestChatSending(true);
    setTestChatError(null);
    let nextRunId = payload.runId;
    if (!nextRunId) {
      nextRunId = `testbot-ui-${crypto.randomUUID()}`;
      setTestRun((prev) => ({
        ...prev,
        id: nextRunId,
        status: "running",
        error: undefined,
        messages: prev.messages ?? [],
        traces: prev.traces ?? [],
        toolInserts: prev.toolInserts ?? [],
      }));
    }
    const requestPayload: Record<string, unknown> = {
      message: "",
      runId: nextRunId,
      workspaceId: payload.runWorkspaceId ?? payload.workspaceId ?? undefined,
      botDeckPath: payload.botDeckPath ?? undefined,
    };
    if (!payload.runWorkspaceId && payload.context !== undefined) {
      requestPayload.context = payload.context;
    }
    try {
      const data = await sendTestMessageRequest(requestPayload);
      if (!data.run) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to start assistant",
        );
      }
    } catch (err) {
      setTestChatError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setTestChatSending(false);
    }
  }, [sendTestMessageRequest]);

  const sendTestMessage = useCallback(
    async (
      message: string,
      payload: {
        runId?: string;
        workspaceId?: string;
        runWorkspaceId?: string;
        botDeckPath?: string;
        context?: unknown;
      },
    ) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      setTestChatSending(true);
      setTestChatError(null);
      let nextRunId = payload.runId;
      const optimisticId = crypto.randomUUID();
      if (!nextRunId) {
        nextRunId = `testbot-ui-${crypto.randomUUID()}`;
        setTestRun((prev) => ({
          ...prev,
          id: nextRunId,
          status: "running",
          error: undefined,
          messages: prev.messages ?? [],
          traces: prev.traces ?? [],
          toolInserts: prev.toolInserts ?? [],
        }));
      }
      setTestOptimisticUser({ id: optimisticId, text: trimmed });
      setTestChatDraft("");
      const requestPayload: Record<string, unknown> = {
        message: trimmed,
        runId: nextRunId,
        workspaceId: payload.runWorkspaceId ?? payload.workspaceId ?? undefined,
        botDeckPath: payload.botDeckPath ?? undefined,
      };
      if (!payload.runWorkspaceId && payload.context !== undefined) {
        requestPayload.context = payload.context;
      }
      try {
        const data = await sendTestMessageRequest(requestPayload);
        if (!data.run) {
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Failed to send message",
          );
        }
      } catch (err) {
        setTestChatError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setTestChatSending(false);
      }
    },
    [sendTestMessageRequest],
  );

  const stopTestRun = useCallback(async (runId: string) => {
    await fetch("/api/test/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId }),
    });
  }, []);

  const resetTestRun = useCallback(() => {
    testRunIdRef.current = "";
    setTestRun(normalizeTestRun());
    setTestStreamingUser(null);
    setTestStreamingAssistant(null);
    setTestChatDraft("");
    setTestChatError(null);
    setTestChatSending(false);
    setTestOptimisticUser(null);
  }, []);

  useEffect(() => {
    if (testOptimisticUser) {
      const lastUser = [...(testRun.messages ?? [])].reverse().find((msg) =>
        msg.role === "user"
      );
      if (lastUser?.content === testOptimisticUser.text) {
        setTestOptimisticUser(null);
      }
    }
    if (testRun.status !== "running" && testOptimisticUser) {
      setTestOptimisticUser(null);
    }
  }, [testOptimisticUser, testRun.messages, testRun.status]);

  const saveTestFeedback = useCallback(async (
    payload: {
      workspaceId: string;
      runId?: string;
      messageRefId: string;
      score: number | null;
      reason?: string;
    },
  ) => {
    const res = await fetch(`${WORKSPACE_API_BASE}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || res.statusText);
    }
    const data = await res.json() as {
      feedback?: FeedbackEntry;
      deleted?: boolean;
    };
    setTestRun((prev) => {
      if (!prev.messages.length) return prev;
      if (data.deleted) {
        return {
          ...prev,
          messages: prev.messages.map((msg) =>
            msg.messageRefId === payload.messageRefId
              ? { ...msg, feedback: undefined }
              : msg
          ),
        };
      }
      if (!data.feedback) return prev;
      return {
        ...prev,
        messages: prev.messages.map((msg) =>
          msg.messageRefId === payload.messageRefId
            ? { ...msg, feedback: data.feedback }
            : msg
        ),
      };
    });
    return data;
  }, []);

  const loadGradeData = useCallback(
    async (
      opts?: { workspaceId?: string | null; gradeRunId?: string | null },
    ) => {
      const reqId = ++gradeLoadSeqRef.current;
      gradeDebugLog("loadData.start", {
        reqId,
        workspaceId: opts?.workspaceId ?? null,
      });
      try {
        setGradeLoading(true);
        const params = new URLSearchParams();
        let data: CalibrateResponse;
        if (opts?.workspaceId) {
          const snapshot = await loadWorkspaceSnapshot(opts.workspaceId, {
            gradeRunId: opts.gradeRunId ?? undefined,
          });
          data = snapshot.grade;
          gradeDebugLog("loadData.response", {
            reqId,
            ok: true,
            status: 200,
            source: "workspace",
          });
        } else {
          data = { graderDecks: [], sessions: [] };
          gradeDebugLog("loadData.response", {
            reqId,
            ok: true,
            status: 200,
            source: "empty",
          });
        }
        setGradeGraders(
          Array.isArray(data.graderDecks) ? data.graderDecks : [],
        );
        setGradeSessions(Array.isArray(data.sessions) ? data.sessions : []);
        gradeDebugLog("loadData.success", {
          reqId,
          graders: Array.isArray(data.graderDecks)
            ? data.graderDecks.length
            : 0,
          sessions: Array.isArray(data.sessions) ? data.sessions.length : 0,
        });
        setGradeError(null);
      } catch (err) {
        gradeDebugLog("loadData.error", {
          reqId,
          message: err instanceof Error ? err.message : String(err),
        });
        setGradeError(
          err instanceof Error
            ? err.message
            : "Failed to load calibration data",
        );
      } finally {
        setGradeLoading(false);
        gradeDebugLog("loadData.end", {
          reqId,
          loading: false,
        });
      }
    },
    [loadWorkspaceSnapshot],
  );

  const loadGradeSessionDetail = useCallback(
    async (targetWorkspaceId: string | null) => {
      const reqId = ++gradeDetailSeqRef.current;
      gradeDebugLog("loadSessionDetail.start", {
        reqId,
        workspaceId: targetWorkspaceId,
      });
      if (!targetWorkspaceId) {
        setGradeSessionDetail(null);
        gradeDebugLog("loadSessionDetail.skip", {
          reqId,
          reason: "missing-workspace-id",
        });
        return;
      }
      try {
        const snapshot = await loadWorkspaceSnapshot(targetWorkspaceId);
        gradeDebugLog("loadSessionDetail.response", {
          reqId,
          workspaceId: targetWorkspaceId,
          ok: true,
          status: 200,
        });
        const data = snapshot.session;
        setGradeSessionDetail(data);
        gradeDebugLog("loadSessionDetail.success", {
          reqId,
          workspaceId: targetWorkspaceId,
          messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
        });
      } catch (err) {
        setGradeSessionDetail(null);
        gradeDebugLog("loadSessionDetail.error", {
          reqId,
          workspaceId: targetWorkspaceId,
          message: err instanceof Error ? err.message : String(err),
        });
        setGradeError(
          err instanceof Error ? err.message : "Failed to load session details",
        );
      }
    },
    [loadWorkspaceSnapshot],
  );

  const runGradeGrader = useCallback(async (
    payload: { workspaceId: string; graderId: string; scenarioRunId?: string },
  ) => {
    try {
      setGradeRunning(true);
      const res = await fetch("/api/calibrate/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || res.statusText);
      }
      const data = await res.json() as {
        session?: CalibrateSession;
        run?: CalibrationRun;
      };
      if (data.session) {
        setGradeSessions((prev) => {
          const index = prev.findIndex((sess) => sess.id === data.session!.id);
          if (index >= 0) {
            const next = [...prev];
            next[index] = data.session!;
            return next;
          }
          return [data.session!, ...prev];
        });
      }
      setGradeError(null);
      return data;
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : "Failed to run grader";
      setGradeError(message);
      throw new Error(message);
    } finally {
      setGradeRunning(false);
    }
  }, []);

  const toggleGradeFlag = useCallback(async (
    payload: {
      workspaceId: string;
      refId: string;
      runId: string;
      turnIndex?: number;
    },
  ) => {
    const res = await fetch("/api/calibrate/flag", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || res.statusText);
    }
    const data = await res.json() as { flags?: GradingFlag[] };
    if (data.flags) {
      setGradeSessionDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          meta: {
            ...(prev.meta ?? {}),
            gradingFlags: data.flags,
          },
        };
      });
    }
    return data;
  }, []);

  const updateGradeFlagReason = useCallback(async (
    payload: { workspaceId: string; refId: string; reason: string },
  ) => {
    const res = await fetch("/api/calibrate/flag/reason", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || res.statusText);
    }
    const data = await res.json() as { flags?: GradingFlag[] };
    if (data.flags) {
      setGradeSessionDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          meta: {
            ...(prev.meta ?? {}),
            gradingFlags: data.flags,
          },
        };
      });
    }
    return data;
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      build: {
        run: buildRun,
        toolCalls: buildToolCalls,
        chatDraft: buildChatDraft,
        setChatDraft: setBuildChatDraft,
        chatSending: buildChatSending,
        chatError: buildChatError,
        setChatError: setBuildChatError,
        toolCallsOpen: buildToolCallsOpen,
        setToolCallsOpen: setBuildToolCallsOpen,
        optimisticUser: buildOptimisticUser,
        setOptimisticUser: setBuildOptimisticUser,
        streamingAssistant: buildStreamingAssistant,
        setStreamingAssistant: setBuildStreamingAssistant,
        stopChat: stopBuildChat,
        resetChat: resetBuildChat,
        sendMessage: sendBuildMessage,
        loadChat: loadBuildChat,
      },
      test: {
        run: testRun,
        setRun: setTestRun,
        streamingUser: testStreamingUser,
        streamingAssistant: testStreamingAssistant,
        chatDraft: testChatDraft,
        setChatDraft: setTestChatDraft,
        chatSending: testChatSending,
        chatError: testChatError,
        setChatError: setTestChatError,
        optimisticUser: testOptimisticUser,
        refreshStatus: refreshTestStatus,
        startRun: startTestRun,
        startAssistant: startTestAssistant,
        sendMessage: sendTestMessage,
        stopRun: stopTestRun,
        resetRun: resetTestRun,
        saveFeedback: saveTestFeedback,
      },
      grade: {
        loading: gradeLoading,
        error: gradeError,
        running: gradeRunning,
        graders: gradeGraders,
        sessions: gradeSessions,
        sessionDetail: gradeSessionDetail,
        loadData: loadGradeData,
        loadSessionDetail: loadGradeSessionDetail,
        runGrader: runGradeGrader,
        toggleFlag: toggleGradeFlag,
        updateFlagReason: updateGradeFlagReason,
      },
      routing: {
        testRunId: activeTestRunId,
        gradeRunId: activeGradeRunId,
        setTestRunId: setActiveTestRunId,
        setGradeRunId: setActiveGradeRunId,
      },
    }),
    [
      buildRun,
      buildToolCalls,
      buildChatDraft,
      buildChatSending,
      buildChatError,
      buildToolCallsOpen,
      buildOptimisticUser,
      buildStreamingAssistant,
      resetBuildChat,
      stopBuildChat,
      sendBuildMessage,
      loadBuildChat,
      testRun,
      testStreamingUser,
      testStreamingAssistant,
      testChatDraft,
      testChatSending,
      testChatError,
      testOptimisticUser,
      refreshTestStatus,
      startTestRun,
      startTestAssistant,
      sendTestMessage,
      stopTestRun,
      resetTestRun,
      saveTestFeedback,
      gradeLoading,
      gradeError,
      gradeRunning,
      gradeGraders,
      gradeSessions,
      gradeSessionDetail,
      loadGradeData,
      loadGradeSessionDetail,
      runGradeGrader,
      toggleGradeFlag,
      updateGradeFlagReason,
      activeTestRunId,
      activeGradeRunId,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

function useWorkspaceContext() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("Workspace hooks must be used within WorkspaceProvider");
  }
  return context;
}

export function useWorkspaceBuild() {
  return useWorkspaceContext().build;
}

export function useWorkspaceTest() {
  return useWorkspaceContext().test;
}

export function useWorkspaceGrade() {
  return useWorkspaceContext().grade;
}

export function useWorkspaceRouting() {
  return useWorkspaceContext().routing;
}
