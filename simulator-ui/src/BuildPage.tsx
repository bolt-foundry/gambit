import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BUILD_STREAM_ID,
  type BuildBotSocketMessage,
  buildDurableStreamUrl,
  classNames,
  getDurableStreamOffset,
  setDurableStreamOffset,
  summarizeToolCalls,
  type ToolCallSummary,
  type TraceEvent,
} from "./utils.ts";
import PageShell from "./gds/PageShell.tsx";
import PageGrid from "./gds/PageGrid.tsx";
import Panel from "./gds/Panel.tsx";
import Button from "./gds/Button.tsx";
import Badge from "./gds/Badge.tsx";
import { ToolCallBubble } from "./shared.tsx";

type BuildRun = {
  id: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  traces?: Array<TraceEvent>;
  toolInserts?: Array<{
    actionCallId?: string;
    parentActionCallId?: string;
    name?: string;
    index: number;
  }>;
};

function extractBotWriteChange(call: ToolCallSummary): {
  path: string;
  action?: string;
  before?: string | null;
  after?: string | null;
} | null {
  if (call.name !== "bot_write") return null;
  const args = call.args as { path?: unknown; contents?: unknown } | undefined;
  const result = (() => {
    if (typeof call.result === "string") {
      try {
        return JSON.parse(call.result) as unknown;
      } catch {
        return undefined;
      }
    }
    return call.result;
  })() as
    | { payload?: { path?: unknown; action?: unknown; before?: unknown } }
    | undefined;
  const pathValue = result?.payload?.path ?? args?.path;
  const pathStr = typeof pathValue === "string" ? pathValue : "";
  if (!pathStr) return null;
  const action = typeof result?.payload?.action === "string"
    ? result.payload.action
    : undefined;
  const before = result?.payload
    ? (typeof result.payload.before === "string"
      ? result.payload.before
      : result.payload.before === null
      ? null
      : undefined)
    : undefined;
  const after = typeof args?.contents === "string" ? args.contents : null;
  return { path: pathStr, action, before, after };
}

export default function BuildPage(props: {
  setNavActions?: (actions: React.ReactNode | null) => void;
}) {
  const { setNavActions } = props;

  const [run, setRun] = useState<BuildRun>({
    id: "",
    status: "idle",
    messages: [],
    traces: [],
    toolInserts: [],
  });
  const runRef = useRef(run);
  const runIdRef = useRef<string>("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [toolCallsOpen, setToolCallsOpen] = useState<Record<number, boolean>>(
    {},
  );
  const [optimisticUser, setOptimisticUser] = useState<
    { id: string; text: string } | null
  >(null);
  const [streamingAssistant, setStreamingAssistant] = useState<
    { runId: string; turn: number; text: string } | null
  >(null);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(null);
    return () => setNavActions(null);
  }, [setNavActions]);

  const refreshStatus = useCallback(async (opts?: { runId?: string }) => {
    const query = opts?.runId ? `?runId=${encodeURIComponent(opts.runId)}` : "";
    const res = await fetch(`/api/build/status${query}`);
    const data = await res.json().catch(() => ({})) as { run?: BuildRun };
    if (data.run) {
      setRun({
        ...data.run,
        messages: data.run.messages ?? [],
        traces: data.run.traces ?? [],
        toolInserts: data.run.toolInserts ?? [],
      });
      if (typeof data.run.id === "string" && data.run.id) {
        runIdRef.current = data.run.id;
      }
    }
  }, []);

  useEffect(() => {
    refreshStatus().catch(() => {});
  }, [refreshStatus]);

  useEffect(() => {
    const streamId = BUILD_STREAM_ID;
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
      const msg = envelope?.data as BuildBotSocketMessage | undefined;
      if (!msg) return;
      const activeRunId = runIdRef.current;
      if (msg.type === "buildBotStatus" && msg.run) {
        if (activeRunId && msg.run.id !== activeRunId) return;
        setRun({
          ...msg.run,
          messages: msg.run.messages ?? [],
          traces: msg.run.traces ?? [],
          toolInserts: msg.run.toolInserts ?? [],
        } as BuildRun);
        return;
      }
      if (msg.type === "buildBotStream") {
        if (!msg.runId || (activeRunId && msg.runId !== activeRunId)) return;
        const streamRunId = msg.runId;
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        if (msg.role !== "assistant") return;
        setStreamingAssistant((prev) =>
          prev && prev.runId === streamRunId && prev.turn === turn
            ? { ...prev, text: prev.text + msg.chunk }
            : { runId: streamRunId, turn, text: msg.chunk }
        );
        return;
      }
      if (msg.type === "buildBotStreamEnd") {
        if (!msg.runId || (activeRunId && msg.runId !== activeRunId)) return;
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        setStreamingAssistant((prev) =>
          prev && prev.runId === msg.runId && prev.turn === turn ? null : prev
        );
      }
    };

    return () => {
      source.close();
    };
  }, []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [run.messages.length, streamingAssistant?.text, optimisticUser?.id]);

  const runStatusLabel = run.status === "running"
    ? "Running…"
    : run.status === "completed"
    ? "Completed"
    : run.status === "error"
    ? "Failed"
    : run.status === "canceled"
    ? "Stopped"
    : "Idle";

  const toolCalls = useMemo(
    () => summarizeToolCalls(run.traces ?? []),
    [run.traces],
  );
  const toolBuckets = useMemo(() => {
    const inserts = run.toolInserts ?? [];
    const byCall = new Map(toolCalls.map((call) => [call.id, call]));
    const buckets = new Map<number, ToolCallSummary[]>();
    for (const insert of inserts) {
      if (!insert.actionCallId) continue;
      const call = byCall.get(insert.actionCallId);
      if (!call) continue;
      const idx = typeof insert.index === "number" ? insert.index : 0;
      const bucket = buckets.get(idx) ?? [];
      bucket.push(call);
      buckets.set(idx, bucket);
    }
    return buckets;
  }, [run.toolInserts, toolCalls]);

  const changes = useMemo(() => {
    return toolCalls
      .map(extractBotWriteChange)
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [toolCalls]);

  const ensureRunId = useCallback(() => {
    if (runIdRef.current) return runIdRef.current;
    const next = `build-ui-${crypto.randomUUID()}`;
    runIdRef.current = next;
    setRun((prev) => ({ ...prev, id: next }));
    return next;
  }, []);

  const resetChat = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) {
      setRun({
        id: "",
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      });
      setChatDraft("");
      setChatError(null);
      setStreamingAssistant(null);
      setOptimisticUser(null);
      setToolCallsOpen({});
      return;
    }
    await fetch("/api/build/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId }),
    }).catch(() => {});
    runIdRef.current = "";
    setRun({
      id: "",
      status: "idle",
      messages: [],
      traces: [],
      toolInserts: [],
    });
    setChatDraft("");
    setChatError(null);
    setStreamingAssistant(null);
    setOptimisticUser(null);
    setToolCallsOpen({});
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    const runId = ensureRunId();
    setChatSending(true);
    setChatError(null);
    try {
      const res = await fetch("/api/build/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, message }),
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
      if (data.run) {
        setRun({
          ...data.run,
          messages: data.run.messages ?? [],
          traces: data.run.traces ?? [],
          toolInserts: data.run.toolInserts ?? [],
        });
        if (typeof data.run.id === "string" && data.run.id) {
          runIdRef.current = data.run.id;
        }
      }
    } finally {
      setChatSending(false);
    }
  }, [ensureRunId]);

  const canStartAssistant = run.status !== "running" && !chatSending &&
    run.messages.length === 0 && !streamingAssistant?.text;

  const handleStartAssistant = useCallback(async () => {
    await sendMessage("");
  }, [sendMessage]);

  const handleSendChat = useCallback(async () => {
    const message = chatDraft.trim();
    if (!message) return;
    setOptimisticUser({ id: crypto.randomUUID(), text: message });
    setChatDraft("");
    try {
      await sendMessage(message);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptimisticUser(null);
    }
  }, [chatDraft, sendMessage]);

  const renderToolBucket = useCallback(
    (index: number, rows: React.ReactNode[]) => {
      const bucket = toolBuckets.get(index);
      if (!bucket || bucket.length === 0) return;
      const isOpen = Boolean(toolCallsOpen[index]);
      rows.push(
        <div key={`tool-bucket-${index}`} className="tool-calls-collapsible">
          <button
            type="button"
            className="tool-calls-toggle"
            onClick={() =>
              setToolCallsOpen((prev) => ({ ...prev, [index]: !prev[index] }))}
          >
            <span className="tool-calls-toggle-label">
              Tool calls ({bucket.length}) · {isOpen ? "Hide" : "Show"}
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
    },
    [toolBuckets, toolCallsOpen],
  );

  return (
    <PageShell>
      <PageGrid as="main" className="editor-main">
        <Panel className="test-bot-sidebar flex-column gap-8 flex-1">
          <div className="flex-row gap-8 items-center">
            <div className="flex-1">
              <strong>Build</strong>
              <div className="placeholder" style={{ marginTop: 8 }}>
                Use this chat to update deck files via Gambit Bot. Tool calls
                show file writes and why they happened.
              </div>
            </div>
            <Badge status={run.status}>{runStatusLabel}</Badge>
            <Button
              variant="secondary"
              onClick={resetChat}
              disabled={chatSending || run.status === "running"}
            >
              New chat
            </Button>
          </div>
          <div className="test-bot-thread">
            <div className="imessage-thread" ref={transcriptRef}>
              {run.messages.length === 0 && (
                <div className="placeholder">No messages yet.</div>
              )}
              {(() => {
                const rows: React.ReactNode[] = [];
                renderToolBucket(0, rows);
                run.messages.forEach((m, idx) => {
                  rows.push(
                    <div
                      key={`${m.role}-${idx}`}
                      className={classNames(
                        "imessage-row",
                        m.role === "user" ? "right" : "left",
                      )}
                    >
                      <div
                        className={classNames(
                          "imessage-bubble",
                          m.role === "user" ? "right" : "left",
                        )}
                        title={m.role}
                      >
                        {m.content}
                      </div>
                    </div>,
                  );
                  renderToolBucket(idx + 1, rows);
                });
                return rows;
              })()}
              {optimisticUser && (
                <div className="imessage-row right">
                  <div className="imessage-bubble right" title="user">
                    {optimisticUser.text}
                  </div>
                </div>
              )}
              {streamingAssistant?.text &&
                streamingAssistant.runId === run.id && (
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
              {canStartAssistant && (
                <div className="placeholder emphasis">
                  Start the assistant to begin editing.
                </div>
              )}
              <div className="flex-row gap-4 mb-2">
                <textarea
                  className="message-input flex-1"
                  rows={1}
                  placeholder={canStartAssistant
                    ? "Start the assistant to begin..."
                    : "Message Gambit Bot..."}
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  disabled={chatSending || run.status === "running"}
                  data-testid="build-chat-input"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!chatSending && run.status !== "running") {
                        handleSendChat();
                      }
                    }
                  }}
                />
                <div className="composer-actions">
                  {canStartAssistant
                    ? (
                      <Button
                        variant="primary"
                        onClick={handleStartAssistant}
                        disabled={!canStartAssistant}
                        data-testid="build-start"
                      >
                        Start
                      </Button>
                    )
                    : (
                      <Button
                        variant="primary"
                        onClick={handleSendChat}
                        disabled={chatSending || run.status === "running" ||
                          chatDraft.trim().length === 0}
                        data-testid="build-send"
                      >
                        Send
                      </Button>
                    )}
                </div>
              </div>
              {chatError && <div className="error">{chatError}</div>}
              {run.status === "error" && run.error && (
                <div className="error">{run.error}</div>
              )}
            </div>
          </div>
        </Panel>
        <div className="flex-column gap-8" style={{ minHeight: 0 }}>
          <Panel className="flex-column gap-8 flex-1" style={{ minHeight: 0 }}>
            <div className="flex-row gap-8 items-center">
              <strong className="flex-1">Changes</strong>
              <Badge variant="ghost" data-testid="build-changes-count">
                {changes.length}
              </Badge>
            </div>
            {changes.length === 0
              ? (
                <div
                  className="placeholder"
                  data-testid="build-changes-panel"
                >
                  No file changes yet.
                </div>
              )
              : (
                <div
                  className="flex-column gap-8"
                  style={{ overflowY: "auto" }}
                  data-testid="build-changes-panel"
                >
                  {changes.map((change, idx) => (
                    <div key={`${change.path}-${idx}`} className="patch-card">
                      <div className="patch-summary">
                        {change.action ?? "updated"}: <code>{change.path}</code>
                      </div>
                      <div className="patch-meta">
                        {change.before === undefined
                          ? "No before snapshot captured."
                          : change.before === null
                          ? "Created file."
                          : "Updated file."}
                      </div>
                      <details>
                        <summary>View before / after</summary>
                        <div className="flex-column gap-8">
                          <div>
                            <div className="patch-meta">Before</div>
                            <pre className="trace-json">
                              {change.before ?? ""}
                            </pre>
                          </div>
                          <div>
                            <div className="patch-meta">After</div>
                            <pre className="trace-json">
                              {change.after ?? ""}
                            </pre>
                          </div>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              )}
          </Panel>
        </div>
      </PageGrid>
    </PageShell>
  );
}
