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
  deckPath,
  deriveInitialFromSchema,
  findMissingRequiredFields,
  getDurableStreamOffset,
  setDurableStreamOffset,
  summarizeToolCalls,
  TEST_BOT_STREAM_ID,
} from "./utils.ts";
import type {
  FeedbackEntry,
  NormalizedSchema,
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
import Button from "./gds/Button.tsx";
import Listbox from "./gds/Listbox.tsx";

export default function TestBotPage(props: {
  onReplaceTestBotSession: (sessionId: string) => void;
  onResetTestBotSession: () => void;
  activeSessionId: string | null;
  setNavActions?: (actions: React.ReactNode | null) => void;
}) {
  const {
    onReplaceTestBotSession,
    onResetTestBotSession,
    activeSessionId,
    setNavActions,
  } = props;
  const deckStorageKey = "gambit:test-bot:selected-deck";
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
  }, [deckPath]);

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

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(
      <Button variant="primary" onClick={handleNewChat}>
        New chat
      </Button>,
    );
    return () => setNavActions(null);
  }, [handleNewChat, setNavActions]);

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
      <div className="editor-main">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            height: "100%",
            overflow: "hidden",
          }}
        >
          <div
            className="editor-panel test-bot-sidebar"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              overflowY: "auto",
            }}
          >
            <strong>Test deck</strong>
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
                No deck-defined personas found. Add <code>[[testDecks]]</code>
                {" "}
                to your deck front matter to drive the Test Bot.
              </div>
            )}
            {botDescription && (
              <div className="placeholder">{botDescription}</div>
            )}
          </div>
          <div
            className="editor-panel test-bot-sidebar"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
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
          </div>
        </div>

        <div className="editor-panel flex-column gap-8">
          <div className="flex-row gap-8 items-center">
            <div className="flex-column flex-1 gap-4">
              <div className="flex-row items-center gap-8">
                <strong>Latest test run</strong>
                <span className={`badge badge--${run.status}`}>
                  {runStatusLabel}
                </span>
              </div>
              {run.sessionId && (
                <div className="editor-status">
                  Session:{" "}
                  <code data-testid="testbot-session-id">{run.sessionId}</code>
                </div>
              )}
            </div>
            <div className="flex-row row-reverse gap-8 wrap">
              <Button
                variant="primary"
                onClick={startRun}
                disabled={!canStart}
                data-testid="testbot-run"
              >
                Run test bot
              </Button>
              <Button
                variant="ghost"
                onClick={stopRun}
                disabled={run.status !== "running"}
                data-testid="testbot-stop"
              >
                Stop
              </Button>
            </div>
          </div>
          {run.error && <div className="error">{run.error}</div>}
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
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <strong>Assistant inputs</strong>
          </div>
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
                <Button variant="ghost" onClick={() => deckSchema.refresh()}>
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
        </div>
      </div>
    </div>
  );
}
