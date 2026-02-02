import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
import Listbox, { type ListboxOption } from "./gds/Listbox.tsx";
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

type BuildFileEntry = {
  path: string;
  type: "file" | "dir";
  size?: number;
  modifiedAt?: string;
};

type BuildFilePreview =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; contents: string }
  | { status: "too-large"; size?: number }
  | { status: "binary"; size?: number }
  | { status: "error"; message: string };

function extractBotWriteChange(call: ToolCallSummary): {
  id: string;
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
  return { id: call.id, path: pathStr, action, before, after };
}

const fileBaseName = (value: string) => value.split(/[\\/]/g).pop() ?? value;

const formatBytes = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const rounded = size >= 10 || unitIndex === 0
    ? Math.round(size)
    : Math.round(size * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
};

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
  const [fileEntries, setFileEntries] = useState<BuildFileEntry[]>([]);
  const [fileListLoading, setFileListLoading] = useState(false);
  const [fileListError, setFileListError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<BuildFilePreview>({
    status: "idle",
  });
  const [recentChangesOpen, setRecentChangesOpen] = useState(false);
  const [recentChangesReadCount, setRecentChangesReadCount] = useState(0);
  const recentChangesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const recentChangesPopoverRef = useRef<HTMLDivElement | null>(null);
  const [recentChangesPopoverStyle, setRecentChangesPopoverStyle] = useState<
    React.CSSProperties | null
  >(null);
  const lastTraceCountRef = useRef<number>(0);

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

  const refreshFileList = useCallback(async () => {
    setFileListLoading(true);
    setFileListError(null);
    try {
      const res = await fetch("/api/build/files");
      const data = await res.json().catch(() => ({})) as {
        entries?: BuildFileEntry[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : res.statusText,
        );
      }
      setFileEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      setFileListError(err instanceof Error ? err.message : String(err));
      setFileEntries([]);
    } finally {
      setFileListLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshFileList().catch(() => {});
  }, [refreshFileList]);

  useEffect(() => {
    const traceCount = run.traces?.length ?? 0;
    if (traceCount === lastTraceCountRef.current) return;
    lastTraceCountRef.current = traceCount;
    refreshFileList().catch(() => {});
  }, [run.traces?.length, refreshFileList]);

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

  const fileEntriesByPath = useMemo(() => {
    const map = new Map<string, BuildFileEntry>();
    for (const entry of fileEntries) {
      if (entry.type === "file") {
        map.set(entry.path, entry);
      }
    }
    return map;
  }, [fileEntries]);

  const fileSelectorOptions = useMemo((): ListboxOption[] => {
    const paths = Array.from(fileEntriesByPath.keys());
    paths.sort((a, b) => a.localeCompare(b));

    const pinnedOrder = [
      "PROMPT.md",
      "root.deck.md",
      "INTENT.md",
      "POLICY.md",
    ];
    const pinned = pinnedOrder.filter((path) => fileEntriesByPath.has(path));
    const pinnedSet = new Set(pinned);
    const rest = paths.filter((path) => !pinnedSet.has(path));

    const toOption = (path: string): ListboxOption => {
      const base = fileBaseName(path);
      return { value: path, label: base, meta: base === path ? null : path };
    };

    const options: ListboxOption[] = [];
    if (pinned.length > 0) {
      options.push({ kind: "header", label: "Pinned" });
      pinned.forEach((path) => options.push(toOption(path)));
    }
    if (rest.length > 0) {
      if (pinned.length > 0) {
        options.push({ kind: "separator" });
        options.push({ kind: "header", label: "All files" });
      }
      rest.forEach((path) => options.push(toOption(path)));
    }
    return options;
  }, [fileEntriesByPath]);

  const selectedEntry = selectedPath
    ? fileEntriesByPath.get(selectedPath)
    : undefined;

  useEffect(() => {
    const filePaths = Array.from(fileEntriesByPath.keys());
    const hasSelected = selectedPath && fileEntriesByPath.has(selectedPath);
    if (selectedPath && !hasSelected) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath && filePaths.length > 0) {
      const preferred = [
        "PROMPT.md",
        "root.deck.md",
        "INTENT.md",
        "POLICY.md",
      ].find((p) => fileEntriesByPath.has(p));
      if (preferred) {
        setSelectedPath(preferred);
      } else {
        filePaths.sort((a, b) => a.localeCompare(b));
        setSelectedPath(filePaths[0]);
      }
    }
  }, [fileEntriesByPath, selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      setFilePreview({ status: "idle" });
      return;
    }
    let canceled = false;
    const fetchPreview = async () => {
      setFilePreview({ status: "loading" });
      try {
        const res = await fetch(
          `/api/build/file?path=${encodeURIComponent(selectedPath)}`,
        );
        const data = await res.json().catch(() => ({})) as {
          contents?: string;
          tooLarge?: boolean;
          binary?: boolean;
          size?: number;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(
            typeof data.error === "string" ? data.error : res.statusText,
          );
        }
        if (data.tooLarge) {
          if (!canceled) {
            setFilePreview({ status: "too-large", size: data.size });
          }
          return;
        }
        if (data.binary) {
          if (!canceled) {
            setFilePreview({ status: "binary", size: data.size });
          }
          return;
        }
        if (!canceled) {
          setFilePreview({
            status: "ready",
            contents: typeof data.contents === "string" ? data.contents : "",
          });
        }
      } catch (err) {
        if (!canceled) {
          setFilePreview({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };
    fetchPreview();
    return () => {
      canceled = true;
    };
  }, [selectedPath]);

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

  const toolInsertIndexByCall = useMemo(() => {
    const map = new Map<string, number>();
    for (const insert of run.toolInserts ?? []) {
      if (!insert.actionCallId) continue;
      map.set(
        insert.actionCallId,
        typeof insert.index === "number" ? insert.index : 0,
      );
    }
    return map;
  }, [run.toolInserts]);

  const changes = useMemo(() => {
    return toolCalls
      .map(extractBotWriteChange)
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [toolCalls]);

  const auditTrail = useMemo(() => {
    const limited = changes.slice(-50);
    return limited.map((change) => ({
      ...change,
      turn: toolInsertIndexByCall.get(change.id),
    }));
  }, [changes, toolInsertIndexByCall]);

  const unreadRecentChangesCount = Math.max(
    0,
    changes.length - recentChangesReadCount,
  );

  const updateRecentChangesPopover = useCallback(() => {
    const trigger = recentChangesTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(380, Math.max(260, window.innerWidth - 24));
    const left = Math.max(
      12,
      Math.min(rect.right - width, window.innerWidth - width - 12),
    );
    setRecentChangesPopoverStyle({
      position: "fixed",
      top: rect.bottom + 6,
      left,
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!recentChangesOpen) return;
    updateRecentChangesPopover();
  }, [recentChangesOpen, updateRecentChangesPopover]);

  useEffect(() => {
    if (!recentChangesOpen) {
      setRecentChangesPopoverStyle(null);
      return;
    }
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const isInTrigger = recentChangesTriggerRef.current &&
        target &&
        recentChangesTriggerRef.current.contains(target);
      const isInPopover = recentChangesPopoverRef.current &&
        target &&
        recentChangesPopoverRef.current.contains(target);
      if (!isInTrigger && !isInPopover) {
        setRecentChangesOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRecentChangesOpen(false);
      }
    };
    const handleReposition = () => updateRecentChangesPopover();
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [recentChangesOpen, updateRecentChangesPopover]);

  useEffect(() => {
    setRecentChangesOpen(false);
    setRecentChangesReadCount(0);
    setRecentChangesPopoverStyle(null);
  }, [run.id]);

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

  const handleStartAssistant = useCallback(async () => {
    if (chatDraft.trim().length > 0) {
      await handleSendChat();
      return;
    }
    await sendMessage("");
  }, [chatDraft, handleSendChat, sendMessage]);

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
      <PageGrid as="main" className="editor-main build-main">
        <Panel className="test-bot-sidebar flex-column gap-8 flex-1 build-chat-panel">
          <div className="flex-row gap-8 items-center">
            <div className="flex-column flex-1 gap-4">
              <div className="flex-row items-center gap-8">
                <strong>Build</strong>
                <Badge status={run.status}>{runStatusLabel}</Badge>
              </div>
              <div className="placeholder">
                Use this chat to update deck files via Gambit Bot. Tool calls
                show file writes and why they happened.
              </div>
            </div>
            <div className="flex-row row-reverse gap-8 wrap">
              <Button
                variant="secondary"
                onClick={resetChat}
                disabled={chatSending || run.status === "running"}
              >
                New chat
              </Button>
            </div>
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
              <div className="composer-inputs">
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
              </div>
              {chatError && <div className="error">{chatError}</div>}
              {run.status === "error" && run.error && (
                <div className="error">{run.error}</div>
              )}
            </div>
          </div>
        </Panel>
        <Panel
          className="flex-column gap-8 flex-1 build-files-panel"
          style={{ minHeight: 0 }}
        >
          {fileListError && <div className="error">{fileListError}</div>}
          <div className="build-files-preview">
            <div className="build-files-preview-header">
              <div className="build-files-preview-controls">
                <div className="build-files-preview-selector">
                  <Listbox
                    value={selectedPath}
                    placeholder={fileListLoading
                      ? "Loading files…"
                      : "Select file"}
                    options={fileSelectorOptions}
                    disabled={fileEntriesByPath.size === 0}
                    onChange={(next) => setSelectedPath(next)}
                  />
                </div>
                <div className="build-files-preview-actions">
                  {selectedEntry?.size !== undefined && (
                    <span className="build-file-size">
                      {formatBytes(selectedEntry.size)}
                    </span>
                  )}
                  <button
                    type="button"
                    className="build-recent-changes-trigger"
                    onClick={() => {
                      if (recentChangesOpen) {
                        setRecentChangesOpen(false);
                        return;
                      }
                      setRecentChangesReadCount(changes.length);
                      updateRecentChangesPopover();
                      setRecentChangesOpen(true);
                    }}
                    aria-haspopup="dialog"
                    aria-expanded={recentChangesOpen}
                    ref={recentChangesTriggerRef}
                  >
                    <span className="build-recent-changes-label">
                      Recent changes
                    </span>
                    <Badge
                      variant={unreadRecentChangesCount > 0
                        ? "running"
                        : "ghost"}
                      data-testid="build-changes-count"
                      className="build-recent-changes-badge"
                    >
                      {unreadRecentChangesCount}
                    </Badge>
                  </button>
                </div>
              </div>
            </div>
            <div className="build-files-preview-body">
              {!selectedPath && (
                <div className="placeholder">
                  Select a file to preview its contents.
                </div>
              )}
              {selectedPath && filePreview.status === "loading" && (
                <div className="placeholder">Loading preview…</div>
              )}
              {selectedPath && filePreview.status === "too-large" && (
                <div className="placeholder">
                  File is too large to preview
                  {filePreview.size
                    ? ` (${formatBytes(filePreview.size)}).`
                    : "."}
                </div>
              )}
              {selectedPath && filePreview.status === "binary" && (
                <div className="placeholder">
                  Cannot preview binary data
                  {filePreview.size
                    ? ` (${formatBytes(filePreview.size)}).`
                    : "."}
                </div>
              )}
              {selectedPath && filePreview.status === "error" && (
                <div className="error">{filePreview.message}</div>
              )}
              {selectedPath && filePreview.status === "ready" && (
                <pre className="build-file-preview">
                  {filePreview.contents}
                </pre>
              )}
            </div>
          </div>
          {recentChangesOpen && recentChangesPopoverStyle &&
            createPortal(
              <div
                className="build-recent-changes-popover"
                style={recentChangesPopoverStyle}
                ref={recentChangesPopoverRef}
                data-testid="build-changes-panel"
              >
                {auditTrail.length === 0
                  ? <div className="placeholder">No recent changes yet.</div>
                  : (
                    <div className="build-recent-changes-list">
                      {[...auditTrail].reverse().map((change, idx) => (
                        <button
                          key={`${change.path}-${idx}`}
                          type="button"
                          className="build-recent-change-row"
                          onClick={() => {
                            setSelectedPath(change.path);
                            setRecentChangesOpen(false);
                          }}
                        >
                          <div className="build-recent-change-summary">
                            {change.action ?? "updated"}:{" "}
                            <code>{change.path}</code>
                          </div>
                          <div className="build-recent-change-meta">
                            {change.before === null
                              ? "Created file."
                              : change.before === undefined
                              ? "No before snapshot."
                              : "Updated file."} {change.turn !== undefined
                              ? `· Turn ${change.turn + 1}`
                              : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
              </div>,
              document.body,
            )}
        </Panel>
      </PageGrid>
    </PageShell>
  );
}
