import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { classNames, type ToolCallSummary } from "./utils.ts";
import Button from "./gds/Button.tsx";
import { ToolCallBubble } from "./shared.tsx";
import { useBuildChat } from "./BuildChatContext.tsx";

export default function Chat() {
  const {
    run,
    toolCalls,
    chatDraft,
    setChatDraft,
    chatSending,
    chatError,
    setChatError,
    toolCallsOpen,
    setToolCallsOpen,
    optimisticUser,
    setOptimisticUser,
    streamingAssistant,
    sendMessage,
  } = useBuildChat();
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [run.messages.length, streamingAssistant?.text, optimisticUser?.id]);

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
  }, [chatDraft, sendMessage, setChatDraft, setChatError, setOptimisticUser]);

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
    [toolBuckets, toolCallsOpen, setToolCallsOpen],
  );

  return (
    <div className="test-bot-sidebar flex-column gap-8 flex-1 build-chat-panel">
      <div className="test-bot-thread">
        <div className="imessage-thread" ref={transcriptRef}>
          <div className="placeholder">
            Use this chat to update deck files via Gambit Bot. Tool calls show
            file writes and why they happened.
          </div>
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
  );
}
