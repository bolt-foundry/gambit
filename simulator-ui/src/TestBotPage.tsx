import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  botFilename,
  buildDurableStreamUrl,
  cloneValue,
  countUserMessages,
  deckDisplayPath,
  deckPath,
  DEFAULT_TEST_PATH,
  deriveInitialFromSchema,
  fileNameFromPath,
  findMissingRequiredFields,
  formatJson,
  getDurableStreamOffset,
  GRADE_STREAM_ID,
  normalizedDeckPath,
  normalizeFsPath,
  repoRootPath,
  setDurableStreamOffset,
  summarizeToolCalls,
  TEST_STREAM_ID,
  toRelativePath,
} from "./utils.ts";
import type {
  CalibrateStreamMessage,
  FeedbackEntry,
  NormalizedSchema,
  SessionDetailResponse,
  TestBotConfigResponse,
  TestBotRun,
  TestBotSocketMessage,
  TestDeckMeta,
  TraceEvent,
} from "./utils.ts";
import {
  FeedbackControls,
  InitForm,
  ToolCallBubble,
  useHttpSchema,
} from "./shared.tsx";
import PageGrid from "./gds/PageGrid.tsx";
import PageShell from "./gds/PageShell.tsx";
import Panel from "./gds/Panel.tsx";
import Button from "./gds/Button.tsx";
import Tabs from "./gds/Tabs.tsx";
import Badge from "./gds/Badge.tsx";
import List from "./gds/List.tsx";
import ListItem from "./gds/ListItem.tsx";
import Listbox from "./gds/Listbox.tsx";
import ScrollingText from "./gds/ScrollingText.tsx";
import CalibrateDrawer from "./CalibrateDrawer.tsx";

export default function TestBotPage(props: {
  onReplaceTestBotSession: (sessionId: string) => void;
  onResetTestBotSession: () => void;
  activeSessionId: string | null;
  resetToken?: number;
  setNavActions?: (actions: React.ReactNode | null) => void;
}) {
  const {
    onReplaceTestBotSession,
    onResetTestBotSession,
    activeSessionId,
    resetToken,
    setNavActions,
  } = props;
  const deckStorageKey = "gambit:test:selected-deck";
  const [testDecks, setTestDecks] = useState<TestDeckMeta[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
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
  const [initialUserMessage] = useState("");
  const [run, setRun] = useState<TestBotRun>({
    status: "idle",
    messages: [],
    traces: [],
    toolInserts: [],
  });
  const [lastInitFill, setLastInitFill] = useState<
    TestBotRun["initFill"] | null
  >(null);
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
  const [assistantDeckTab, setAssistantDeckTab] = useState<
    "input" | "tools" | "schema"
  >("input");

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
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [optimisticUser, setOptimisticUser] = useState<
    { id: string; text: string } | null
  >(null);
  const [sessionDetail, setSessionDetail] = useState<
    SessionDetailResponse | null
  >(null);
  const [sessionDetailError, setSessionDetailError] = useState<string | null>(
    null,
  );
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const pollRef = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef<string | undefined>(undefined);
  const resetSkipRef = useRef(false);
  const handleNewChatRef = useRef<() => void>(() => {});
  const allowRunSessionNavRef = useRef(false);
  const missingSessionRef = useRef<string | null>(null);
  const missingSessionRetryRef = useRef<Record<string, number>>({});
  const sessionDetailRequestRef = useRef(0);
  const sessionIdForDrawerRef = useRef<string | null>(null);
  const sessionIdForDrawer = activeSessionId ?? run.sessionId ?? null;

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    const requestId = ++sessionDetailRequestRef.current;
    const shouldApply = () =>
      requestId === sessionDetailRequestRef.current &&
      sessionIdForDrawerRef.current === sessionId;
    try {
      setSessionDetailLoading(true);
      const res = await fetch(
        `/api/session?sessionId=${encodeURIComponent(sessionId)}`,
      );
      if (!res.ok) {
        if (!shouldApply()) return;
        if (res.status === 404 || res.status === 502) {
          const activeRun = runRef.current;
          const isActiveRunSession = activeRun.sessionId === sessionId;
          const shouldRetryMissing = isActiveRunSession &&
            (activeRun.status === "running" ||
              activeRun.status === "completed");
          if (shouldRetryMissing) {
            const attempts = missingSessionRetryRef.current[sessionId] ?? 0;
            if (attempts < 5) {
              missingSessionRetryRef.current[sessionId] = attempts + 1;
              setSessionDetailLoading(false);
              setSessionDetailError(null);
              window.setTimeout(() => {
                if (sessionIdForDrawerRef.current === sessionId) {
                  loadSessionDetail(sessionId).catch(() => {});
                }
              }, 500);
              return;
            }
          }
          if (missingSessionRef.current === sessionId) return;
          missingSessionRef.current = sessionId;
          delete missingSessionRetryRef.current[sessionId];
          setSessionDetail(null);
          setSessionDetailError(null);
          setRun((prev) =>
            prev.sessionId === sessionId
              ? {
                id: "",
                status: "idle",
                messages: [],
                traces: [],
                toolInserts: [],
                sessionId: undefined,
              }
              : prev
          );
          onResetTestBotSession();
          window.location.assign(DEFAULT_TEST_PATH);
          return;
        }
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = await res.json() as SessionDetailResponse;
      if (!shouldApply()) return;
      const sessionDeck = typeof data?.meta?.deck === "string"
        ? data.meta.deck
        : null;
      if (sessionDeck) {
        const normalizedSessionDeck = normalizeFsPath(sessionDeck);
        const relative = toRelativePath(normalizedSessionDeck, repoRootPath);
        const matchesCurrentDeck =
          normalizedSessionDeck === normalizedDeckPath ||
          (relative &&
            normalizeFsPath(relative) === normalizeFsPath(deckDisplayPath));
        if (!matchesCurrentDeck) {
          setSessionDetail(null);
          setSessionDetailError(null);
          setRun((prev) =>
            prev.sessionId === sessionId
              ? {
                id: "",
                status: "idle",
                messages: [],
                traces: [],
                toolInserts: [],
                sessionId: undefined,
              }
              : prev
          );
          onResetTestBotSession();
          window.location.assign(DEFAULT_TEST_PATH);
          return;
        }
      }
      setSessionDetail(data);
      setSessionDetailError(null);
      missingSessionRef.current = null;
      delete missingSessionRetryRef.current[sessionId];
    } catch (err) {
      if (!shouldApply()) return;
      setSessionDetailError(
        err instanceof Error ? err.message : "Failed to load session details",
      );
      setSessionDetail(null);
    } finally {
      if (shouldApply()) setSessionDetailLoading(false);
    }
  }, [onResetTestBotSession]);

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
      return fetch(`/api/test${query}`);
    };
    const loadResponse = async (
      res: Response,
    ): Promise<TestBotConfigResponse> => {
      if (!res.ok) throw new Error(res.statusText);
      return await res.json() as TestBotConfigResponse;
    };
    try {
      let data: TestBotConfigResponse;
      if (!opts?.deckId && storedDeckId) {
        const initial = await fetchTestBotConfig();
        data = await loadResponse(initial);
        const decks = Array.isArray(data.testDecks) ? data.testDecks : [];
        if (decks.some((deck) => deck.id === storedDeckId)) {
          const res = await fetchTestBotConfig(storedDeckId);
          data = await loadResponse(res);
        } else {
          try {
            localStorage.removeItem(deckStorageKey);
          } catch {
            // ignore storage failures
          }
        }
      } else {
        let res = await fetchTestBotConfig(requestedDeckId);
        if (!res.ok && res.status === 400 && requestedDeckId) {
          try {
            localStorage.removeItem(deckStorageKey);
          } catch {
            // ignore storage failures
          }
          res = await fetchTestBotConfig();
        }
        data = await loadResponse(res);
      }
      const decks = Array.isArray(data.testDecks) ? data.testDecks : [];
      setTestDecks(decks);
      setBotDescription(
        typeof data.botDescription === "string" ? data.botDescription : null,
      );
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
    if (
      activeSessionId && run.sessionId !== activeSessionId &&
      !allowRunSessionNavRef.current
    ) {
      return;
    }
    onReplaceTestBotSession(run.sessionId);
    allowRunSessionNavRef.current = false;
  }, [activeSessionId, onReplaceTestBotSession, run.sessionId]);

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
    sessionIdForDrawerRef.current = sessionIdForDrawer;
    if (!sessionIdForDrawer) {
      setSessionDetail(null);
      setSessionDetailError(null);
      setSessionDetailLoading(false);
      return;
    }
    loadSessionDetail(sessionIdForDrawer).catch(() => {});
  }, [loadSessionDetail, sessionIdForDrawer]);

  useEffect(() => {
    if (!sessionIdForDrawer) return;
    sessionIdForDrawerRef.current = sessionIdForDrawer;
    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        loadSessionDetail(sessionIdForDrawer).catch(() => {});
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [loadSessionDetail, sessionIdForDrawer]);

  useEffect(() => {
    const streamId = TEST_STREAM_ID;
    const streamUrl = buildDurableStreamUrl(
      streamId,
      getDurableStreamOffset(streamId),
    );
    const source = new EventSource(streamUrl);

    source.onopen = () => {
      console.info("[test] stream open", streamUrl);
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
      console.warn("[test] stream error", err);
    };

    return () => {
      console.info("[test] stream cleanup");
      source.close();
    };
  }, [deckPath]);

  useEffect(() => {
    if (!sessionIdForDrawer) return;
    const streamId = GRADE_STREAM_ID;
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
      if (msg.sessionId !== sessionIdForDrawer) return;
      loadSessionDetail(sessionIdForDrawer).catch(() => {});
    };

    return () => {
      source.close();
    };
  }, [loadSessionDetail, sessionIdForDrawer]);

  const refreshStatus = useCallback(async (
    opts?: { runId?: string; sessionId?: string },
  ) => {
    try {
      const runId = opts?.runId ??
        (opts?.sessionId ? undefined : run.id);
      const sessionId = opts?.sessionId;
      const params = new URLSearchParams();
      if (runId) params.set("runId", runId);
      if (sessionId) params.set("sessionId", sessionId);
      const deckParam = testDecks.length
        ? (selectedDeckId || testDecks[0]?.id || "")
        : "";
      if (deckParam) params.set("deckPath", deckParam);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/test/status${query}`);
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
    if (activeSessionId) return;
    refreshStatus();
  }, [activeSessionId, refreshStatus]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (allowRunSessionNavRef.current) return;
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

  const handleDeckInitChange = useCallback((next: unknown) => {
    setDeckInitValue(next);
    setDeckInitDirty(true);
  }, []);

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
  const deckTools = useMemo(() => {
    const tools = deckSchema.schemaResponse?.tools;
    if (!Array.isArray(tools)) return [];
    return tools
      .filter(
        (tool): tool is {
          name: string;
          label?: string;
          description?: string;
          path?: string;
        } => Boolean(tool && typeof tool.name === "string"),
      )
      .map((tool) => {
        const pathValue = typeof tool.path === "string" ? tool.path : undefined;
        const fileName = fileNameFromPath(pathValue);
        return {
          name: tool.name,
          label: tool.label && tool.label.trim().length > 0
            ? tool.label
            : tool.name,
          description: tool.description,
          path: pathValue,
          fileName,
        };
      })
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      );
  }, [deckSchema.schemaResponse?.tools]);

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
    const map = new Map<number, ReturnType<typeof summarizeToolCalls>>();
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
  const hasPersonaSelection = Boolean(selectedDeckId);
  const hasDeckSelection = !canRunPersona || hasPersonaSelection;
  const canStart = canRunPersona && hasPersonaSelection &&
    (!botInputSchema || missingBotInput.length === 0) &&
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
    if (optimisticUser) {
      const lastUser = [...run.messages].reverse().find((msg) =>
        msg.role === "user"
      );
      if (lastUser?.content === optimisticUser.text) {
        setOptimisticUser(null);
      }
    }
    if (run.status !== "running" && optimisticUser) {
      setOptimisticUser(null);
    }
    if (
      streamingAssistant &&
      run.messages.some((msg) =>
        msg.role === "assistant" &&
        typeof msg.content === "string" &&
        msg.content.includes(streamingAssistant.text)
      )
    ) {
      setStreamingAssistant(null);
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
      allowRunSessionNavRef.current = true;
      const initFillRequest = missingDeckInit.length > 0
        ? { requested: missingDeckInit }
        : null;
      if (initFillRequest) {
        setLastInitFill(initFillRequest);
        console.info("[test-bot] init fill requested", initFillRequest);
      }
      const payload: Record<string, unknown> = {
        botInput: botInputValue,
        initialUserMessage,
        botDeckPath: selectedDeckId ?? undefined,
        context: deckInitValue,
        initFill: missingDeckInit.length > 0
          ? { missing: missingDeckInit }
          : undefined,
      };
      const res = await fetch("/api/test/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({})) as {
        run?: TestBotRun;
        error?: string;
        initFill?: TestBotRun["initFill"];
        sessionPath?: string;
      };
      if (!res.ok) {
        allowRunSessionNavRef.current = false;
        if (data.initFill) {
          setLastInitFill(data.initFill);
          console.info("[test-bot] init fill error", data.initFill);
        }
        if (data.sessionPath) {
          console.info(
            "[test-bot] init fill session saved",
            data.sessionPath,
          );
        }
        setRun({
          status: "error",
          error: typeof data.error === "string" ? data.error : res.statusText,
          initFill: data.initFill,
          messages: [],
          traces: [],
          toolInserts: [],
        });
        return;
      }
      if (data.run) {
        if (data.run.initFill) {
          setLastInitFill(data.run.initFill);
          console.info("[test-bot] init fill applied", data.run.initFill);
        }
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
      allowRunSessionNavRef.current = false;
      console.error(err);
    }
  }, [
    deckInitValue,
    botInputValue,
    initialUserMessage,
    refreshStatus,
    selectedDeckId,
    missingDeckInit,
  ]);

  const stopRun = useCallback(async () => {
    if (!run.id) return;
    try {
      await fetch("/api/test/stop", {
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
      id: "",
      status: "idle",
      messages: [],
      traces: [],
      toolInserts: [],
      sessionId: undefined,
    });
    missingSessionRef.current = null;
    onResetTestBotSession();
  }, [onResetTestBotSession, run.status, stopRun]);

  useEffect(() => {
    handleNewChatRef.current = handleNewChat;
  }, [handleNewChat]);

  useEffect(() => {
    if (!resetSkipRef.current) {
      resetSkipRef.current = true;
      return;
    }
    if (resetToken === undefined) return;
    handleNewChatRef.current();
  }, [resetToken]);

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(null);
    return () => setNavActions(null);
  }, [handleNewChat, setNavActions]);

  const saveTestBotFeedback = useCallback(
    async (messageRefId: string, score: number | null, reason?: string) => {
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
        const data = await res.json() as {
          feedback?: FeedbackEntry;
          deleted?: boolean;
        };
        if (data.deleted) {
          setRun((prev) => ({
            ...prev,
            messages: prev.messages.map((msg) =>
              msg.messageRefId === messageRefId
                ? { ...msg, feedback: undefined }
                : msg
            ),
          }));
          setSessionDetail((prev) => {
            if (!prev) return prev;
            const existing = prev.feedback ?? [];
            return {
              ...prev,
              feedback: existing.filter((entry) =>
                entry.messageRefId !== messageRefId
              ),
            };
          });
          return;
        }
        if (data.feedback) {
          setRun((prev) => ({
            ...prev,
            messages: prev.messages.map((msg) =>
              msg.messageRefId === messageRefId
                ? { ...msg, feedback: data.feedback }
                : msg
            ),
          }));
          setSessionDetail((prev) => {
            if (!prev) return prev;
            const existing = prev.feedback ?? [];
            const nextFeedback = (() => {
              const index = existing.findIndex((entry) =>
                entry.messageRefId === messageRefId
              );
              if (index >= 0) {
                const next = [...existing];
                next[index] = data.feedback!;
                return next;
              }
              return [data.feedback!, ...existing];
            })();
            return {
              ...prev,
              feedback: nextFeedback,
            };
          });
        }
      } catch (err) {
        console.error(err);
      }
    },
    [run.sessionId],
  );

  const handleTestBotScore = useCallback(
    (messageRefId: string, score: number | null) => {
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
    ? "Running…"
    : run.status === "completed"
    ? "Completed"
    : run.status === "error"
    ? "Failed"
    : run.status === "canceled"
    ? "Stopped"
    : "Idle";

  const startMode = deckSchema.schemaResponse?.startMode ?? "assistant";
  const isUserStart = startMode === "user";
  const showStartOverlay = hasDeckSelection &&
    startMode === "assistant" &&
    run.status !== "running" &&
    run.messages.length === 0 &&
    !streamingAssistant?.text &&
    !streamingUser?.text;
  const canStartAssistant = showStartOverlay &&
    !chatSending &&
    run.status !== "running" &&
    (run.sessionId ||
      (deckJsonErrorCount === 0 && missingDeckInit.length === 0));

  const canSendChat = hasDeckSelection &&
    run.status !== "running" &&
    !chatSending &&
    chatDraft.trim().length > 0 &&
    !showStartOverlay &&
    (run.sessionId ||
      (deckJsonErrorCount === 0 && missingDeckInit.length === 0));

  const handleStartAssistant = useCallback(async () => {
    if (!hasDeckSelection || chatSending) return;
    setChatSending(true);
    setChatError(null);
    let nextRunId = run.id;
    if (!nextRunId) {
      nextRunId = `testbot-ui-${crypto.randomUUID()}`;
      setRun((prev) => ({
        ...prev,
        id: nextRunId,
        status: "running",
        error: undefined,
        messages: prev.messages ?? [],
        traces: prev.traces ?? [],
        toolInserts: prev.toolInserts ?? [],
      }));
    }
    try {
      const payload: Record<string, unknown> = {
        message: "",
        runId: nextRunId,
        sessionId: run.sessionId,
        botDeckPath: selectedDeckId ?? undefined,
      };
      if (!run.sessionId) {
        payload.context = deckInitValue;
      }
      const res = await fetch("/api/test/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({})) as {
        run?: TestBotRun;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : res.statusText,
        );
      }
      if (data.run) {
        setRun({
          ...data.run,
          messages: data.run.messages ?? [],
          traces: data.run.traces ?? [],
          toolInserts: data.run.toolInserts ?? [],
        });
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatSending(false);
    }
  }, [
    chatSending,
    deckInitValue,
    hasDeckSelection,
    run.id,
    run.sessionId,
    selectedDeckId,
  ]);

  const handleSendChat = useCallback(async () => {
    const message = chatDraft.trim();
    if (!message) return;
    setChatSending(true);
    setChatError(null);
    let nextRunId = run.id;
    const optimisticId = crypto.randomUUID();
    if (!nextRunId) {
      nextRunId = `testbot-ui-${crypto.randomUUID()}`;
      setRun((prev) => ({
        ...prev,
        id: nextRunId,
        status: "running",
        error: undefined,
        messages: prev.messages ?? [],
        traces: prev.traces ?? [],
        toolInserts: prev.toolInserts ?? [],
      }));
    }
    setOptimisticUser({ id: optimisticId, text: message });
    setChatDraft("");
    try {
      const payload: Record<string, unknown> = {
        message,
        runId: nextRunId,
        sessionId: run.sessionId,
        botDeckPath: selectedDeckId ?? undefined,
      };
      if (!run.sessionId) {
        payload.context = deckInitValue;
      }
      const res = await fetch("/api/test/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({})) as {
        run?: TestBotRun;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : res.statusText,
        );
      }
      if (data.run) {
        setRun({
          ...data.run,
          messages: data.run.messages ?? [],
          traces: data.run.traces ?? [],
          toolInserts: data.run.toolInserts ?? [],
        });
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatSending(false);
    }
  }, [
    chatDraft,
    deckInitValue,
    run.id,
    run.sessionId,
    run.status,
    selectedDeckId,
  ]);

  return (
    <PageShell>
      <PageGrid as="main" className="editor-main">
        <div
          className="flex-column gap-8"
          style={{
            height: "100%",
            overflow: "hidden",
          }}
        >
          <Panel className="test-bot-sidebar flex-column gap-8 flex-1">
            <div className="flex-row gap-8 items-center">
              <div className="flex-1">
                <strong>Test deck</strong>
              </div>
              <Button
                variant="primary"
                onClick={startRun}
                disabled={!canStart}
                data-testid="testbot-run"
              >
                Run test bot
              </Button>
            </div>
            {testDecks.length > 0 && (
              <Listbox
                value={selectedDeckId ?? ""}
                onChange={handleDeckSelection}
                options={testDecks.map((deck) => ({
                  value: deck.id,
                  label: deck.label,
                  meta: botFilename(deck.path),
                }))}
              />
            )}
            {testDecks.length === 0 && (
              <div className="placeholder">
                No deck-defined personas found. Add <code>[[scenarios]]</code>
                {" "}
                (or legacy{" "}
                <code>[[testDecks]]</code>) to your deck front matter to drive
                the Test Bot.
              </div>
            )}
            {botDescription && (
              <div className="placeholder">{botDescription}</div>
            )}
            <strong>Test deck input</strong>
            <div style={{ flex: 1 }}>
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
            </div>
          </Panel>

          <Panel className="flex-column gap-10 flex-1">
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <strong>Assistant deck</strong>
            </div>
            <Tabs
              className="panel-tabs"
              style={{ marginTop: 6 }}
              size="small"
              tabClassName="flex-1"
              activeId={assistantDeckTab}
              onChange={(next) =>
                setAssistantDeckTab(next as typeof assistantDeckTab)}
              tabs={[
                { id: "input", label: "Input" },
                { id: "tools", label: "Tools" },
                { id: "schema", label: "Schema" },
              ]}
            />
            {assistantDeckTab === "input" && (
              <>
                {deckSchema.loading && (
                  <div className="editor-status">Loading schema…</div>
                )}
                {deckSchemaError && (
                  <div className="error">{deckSchemaError}</div>
                )}
                {deckInputSchema && (
                  <>
                    <InitForm
                      schema={deckInputSchema}
                      value={deckInitValue}
                      onChange={handleDeckInitChange}
                      onJsonErrorChange={(pathKey, err) =>
                        setDeckJsonErrors((prev) =>
                          prev[pathKey] === err
                            ? prev
                            : { ...prev, [pathKey]: err }
                        )}
                    />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button
                        variant="ghost"
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
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => deckSchema.refresh()}
                      >
                        Refresh schema
                      </Button>
                    </div>
                  </>
                )}
                {!deckInputSchema && !deckSchema.loading && (
                  <div className="placeholder">
                    No input schema found for this deck.
                  </div>
                )}
              </>
            )}
            {assistantDeckTab === "tools" && (
              <>
                {deckSchema.loading && (
                  <div className="editor-status">Loading tools…</div>
                )}
                {deckSchemaError && (
                  <div className="error">{deckSchemaError}</div>
                )}
                {!deckSchema.loading && !deckSchemaError &&
                  deckTools.length === 0 && (
                  <div className="placeholder">
                    No tools declared for this deck.
                  </div>
                )}
                {deckTools.length > 0 && (
                  <List>
                    {deckTools.map((tool) => (
                      <ListItem
                        key={tool.name}
                        title={tool.label}
                        meta={tool.fileName
                          ? <code>{tool.fileName}</code>
                          : null}
                        description={tool.description}
                      />
                    ))}
                  </List>
                )}
              </>
            )}
            {assistantDeckTab === "schema" && (
              <div className="flex-column gap-6 flex-1">
                {deckSchema.loading && (
                  <div className="editor-status">Loading schema…</div>
                )}
                {deckSchemaError && (
                  <div className="error">{deckSchemaError}</div>
                )}
                {!deckSchema.loading && !deckSchemaError && (
                  deckSchema.schemaResponse
                    ? (
                      <List className="flex-1">
                        <ListItem
                          title="Deck metadata"
                          description={
                            <>
                              <div className="flex-row gap-4">
                                <span>
                                  <strong>Path</strong>:
                                </span>
                                <ScrollingText
                                  as="div"
                                  text={deckSchema.schemaResponse?.deck ??
                                    "unknown"}
                                />
                              </div>
                              <div>
                                <strong>Start mode</strong>:{" "}
                                {deckSchema.schemaResponse?.startMode ??
                                  "assistant"}
                              </div>
                              {deckSchema.schemaResponse?.modelParams &&
                                (
                                  <div className="flex-column gap-4">
                                    <strong>Model params</strong>
                                    <pre className="trace-json">
                                      {formatJson(
                                        deckSchema.schemaResponse?.modelParams,
                                      )}
                                    </pre>
                                  </div>
                                )}
                            </>
                          }
                        />
                      </List>
                    )
                    : (
                      <div className="placeholder">
                        No schema available for this deck.
                      </div>
                    )
                )}
              </div>
            )}
          </Panel>
        </div>

        <Panel className="flex-column gap-8">
          <div className="flex-row gap-8 items-center">
            <div className="flex-column flex-1 gap-4">
              <div className="flex-row items-center gap-8">
                <strong>Test run</strong>
                <Badge variant={run.status} data-testid="testbot-status">
                  {runStatusLabel}
                </Badge>
              </div>
            </div>
            <div className="flex-row row-reverse gap-8 wrap">
              <Button
                variant="ghost"
                onClick={stopRun}
                disabled={run.status !== "running"}
                data-testid="testbot-stop"
              >
                Stop
              </Button>
              <Button variant="secondary" onClick={handleNewChat}>
                New chat
              </Button>
            </div>
          </div>
          {run.error && <div className="error">{run.error}</div>}
          {(run.initFill ?? lastInitFill) && (
            <div className="patch-card">
              <div className="patch-summary">Init fill</div>
              {(run.initFill ?? lastInitFill)?.error && (
                <div className="error">
                  {(run.initFill ?? lastInitFill)?.error}
                </div>
              )}
              <div className="patch-meta">
                Requested: {(run.initFill ?? lastInitFill)?.requested?.length
                  ? (run.initFill ?? lastInitFill)!.requested.join(", ")
                  : "none"}
              </div>
              {(run.initFill ?? lastInitFill)?.applied !== undefined && (
                <pre className="trace-json">
                  {formatJson((run.initFill ?? lastInitFill)?.applied)}
                </pre>
              )}
              {(run.initFill ?? lastInitFill)?.applied === undefined && (
                <div className="patch-meta">No fills applied.</div>
              )}
            </div>
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
          {canStart && missingDeckInit.length > 0 && (
            <div className="placeholder">
              Missing required init fields will be requested from the persona:
              {" "}
              {missingDeckInit.slice(0, 6).join(", ")}
              {missingDeckInit.length > 6 ? "…" : ""}
            </div>
          )}
          <div className="test-bot-thread">
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
                        onClick={() => setToolCallsOpen((prev) => ({
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
                  const messageKey = m.messageRefId ?? `${m.role}-${idx}`;
                  rows.push(
                    <div
                      key={messageKey}
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
                        {(
                            m.respondPayload !== undefined ||
                            m.respondMeta !== undefined ||
                            typeof m.respondStatus === "number" ||
                            typeof m.respondMessage === "string" ||
                            typeof m.respondCode === "string"
                          )
                          ? (
                            <div className="respond-summary">
                              <div className="respond-meta">
                                <Badge>gambit_respond</Badge>
                                {typeof m.respondStatus === "number" && (
                                  <Badge variant="ghost">
                                    status {m.respondStatus}
                                  </Badge>
                                )}
                                {m.respondCode && (
                                  <Badge variant="ghost">
                                    code {m.respondCode}
                                  </Badge>
                                )}
                              </div>
                              {m.respondMessage && (
                                <div className="respond-message">
                                  {m.respondMessage}
                                </div>
                              )}
                              {m.respondPayload !== undefined && (
                                <pre className="bubble-json">
                                  {formatJson(m.respondPayload)}
                                </pre>
                              )}
                              {m.respondMeta && (
                                <details className="respond-meta-details">
                                  <summary>Meta</summary>
                                  <pre className="bubble-json">
                                    {formatJson(m.respondMeta)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          )
                          : m.content}
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
                  <div className="imessage-row right">
                    <div
                      className="imessage-bubble right imessage-bubble-muted"
                      title="user"
                    >
                      {streamingUser.text}
                    </div>
                  </div>
                )}
              {optimisticUser && (
                <div className="imessage-row right">
                  <div
                    className="imessage-bubble right"
                    title="user"
                  >
                    {optimisticUser.text}
                  </div>
                </div>
              )}
              {streamingAssistant?.text &&
                streamingAssistant.runId === run.id &&
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
            <div className="composer">
              <div className="composer-inputs">
                {isUserStart && run.messages.length === 0 &&
                  !streamingAssistant?.text && !streamingUser?.text && (
                  <div className="placeholder emphasis">
                    This deck expects a user message to kick things off.
                  </div>
                )}
                <div className="flex-row gap-4 mb-2">
                  <textarea
                    className="message-input flex-1"
                    rows={1}
                    placeholder={showStartOverlay
                      ? "Start the assistant to begin..."
                      : isUserStart && run.messages.length === 0
                      ? "Send the first message to begin..."
                      : "Message the assistant..."}
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    disabled={showStartOverlay}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (canSendChat) {
                          handleSendChat();
                        }
                      }
                    }}
                  />
                  <div className="composer-actions">
                    <Button
                      variant="primary"
                      onClick={handleSendChat}
                      disabled={!canSendChat}
                      data-testid="testbot-chat-send"
                    >
                      Send
                    </Button>
                  </div>
                </div>
              </div>
              {chatError && <div className="error">{chatError}</div>}
            </div>
            {showStartOverlay && (
              <div className="test-bot-thread-overlay">
                <div className="test-bot-thread-card">
                  <strong className="test-bot-thread-title">
                    Choose how to start
                  </strong>
                  <div className="placeholder test-bot-thread-subtitle">
                    Pick the flow you want: manual conversation or a full test
                    bot run.
                  </div>
                  <div className="test-bot-thread-sections">
                    <div className="test-bot-thread-section">
                      <div className="test-bot-thread-section-title">
                        Start the assistant
                      </div>
                      <div className="test-bot-thread-section-body">
                        Use this when you want to explore the chat manually.
                      </div>
                      <Button
                        variant="secondary"
                        onClick={handleStartAssistant}
                        disabled={!canStartAssistant}
                        data-testid="testbot-start-assistant"
                      >
                        Start assistant
                      </Button>
                    </div>
                    <div className="test-bot-thread-section">
                      <div className="test-bot-thread-section-title">
                        Run test bot
                      </div>
                      <div className="test-bot-thread-section-body">
                        Run the configured test bot to execute the scenario
                        end-to-end.
                      </div>
                      <Button
                        variant="primary"
                        onClick={startRun}
                        disabled={!canStart}
                        data-testid="testbot-run-overlay"
                      >
                        Run test bot
                      </Button>
                    </div>
                  </div>
                  {chatError && <div className="error">{chatError}</div>}
                </div>
              </div>
            )}
          </div>
        </Panel>
        <CalibrateDrawer
          loading={sessionDetailLoading}
          error={sessionDetailError}
          sessionId={sessionIdForDrawer}
          sessionDetail={sessionDetail}
          messages={run.messages}
        />
      </PageGrid>
    </PageShell>
  );
}
