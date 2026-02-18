import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  type BuildDisplayMessage,
  classNames,
  renderMarkdown,
} from "./utils.ts";
import Button from "./gds/Button.tsx";
import {
  ActivityTranscriptRows,
  bucketBuildChatDisplay,
} from "./ActivityTranscriptRows.tsx";
import { useBuildChat } from "./BuildChatContext.tsx";

export { bucketBuildChatDisplay };

export function BuildChatRows(props: { display: BuildDisplayMessage[] }) {
  const { display } = props;
  return (
    <ActivityTranscriptRows
      display={display}
      renderMessage={(entry, messageOrdinal) => {
        const role = entry.role ?? "assistant";
        return (
          <div
            className={classNames(
              "imessage-row",
              role === "user" ? "right" : "left",
            )}
            key={`message-${messageOrdinal}-${role}`}
          >
            <div
              className={classNames(
                "imessage-bubble",
                role === "user" ? "right" : "left",
              )}
              title={role}
            >
              <div
                className="bubble-text"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(entry.content ?? ""),
                }}
              />
            </div>
          </div>
        );
      }}
    />
  );
}

export type BuildChatActivityState =
  | "Idle"
  | "Thinking"
  | "Responding"
  | "Stopped";

export function deriveBuildChatActivityState(
  args: {
    runStatus: "idle" | "running" | "completed" | "error" | "canceled";
    chatSending: boolean;
    display: BuildDisplayMessage[];
    streamingAssistant: { runId: string; turn: number; text: string } | null;
    runId: string;
  },
): BuildChatActivityState {
  const { runStatus, chatSending, display, streamingAssistant, runId } = args;
  const isActive = chatSending || runStatus === "running";
  const hasStreamingText = Boolean(
    streamingAssistant &&
      streamingAssistant.runId === runId &&
      streamingAssistant.text.trim().length > 0,
  );
  const hasAssistantTranscriptText = display.some((entry) =>
    entry.kind === "message" &&
    (entry.role ?? "assistant") === "assistant" &&
    typeof entry.content === "string" &&
    entry.content.trim().length > 0
  );
  const hasVisibleAssistantText = hasStreamingText ||
    hasAssistantTranscriptText;
  if (isActive) {
    return hasVisibleAssistantText ? "Responding" : "Thinking";
  }
  if (
    runStatus === "completed" || runStatus === "error" ||
    runStatus === "canceled"
  ) {
    return "Stopped";
  }
  return "Idle";
}

export function formatElapsedDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, "0")}:${
    String(seconds).padStart(2, "0")
  }`;
}

export type BuildChatViewState = ReturnType<typeof useBuildChat>;

function BuildChatActivityIndicator(
  props: { state: BuildChatActivityState },
) {
  const { state } = props;
  const active = state === "Thinking" || state === "Responding";
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) {
      setStartedAtMs(null);
      setTick(0);
      return;
    }
    setStartedAtMs((prev) => prev ?? Date.now());
    const handle = globalThis.setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);
    return () => globalThis.clearInterval(handle);
  }, [active]);

  if (!active) return null;
  const elapsedSeconds = startedAtMs === null
    ? 0
    : Math.floor((Date.now() - startedAtMs) / 1000);
  const statusLabel = state === "Thinking"
    ? "Assistant is thinking"
    : "Assistant is responding";

  return (
    <div
      className={classNames(
        "build-chat-activity-indicator",
        state === "Thinking"
          ? "build-chat-activity-indicator-thinking"
          : "build-chat-activity-indicator-responding",
      )}
      role="status"
      aria-live="polite"
      data-testid="build-chat-activity-indicator"
      data-activity-state={state}
      data-activity-tick={tick}
    >
      <span className="build-chat-activity-glimmer" aria-hidden="true" />
      <span className="build-chat-activity-spinner" aria-hidden="true" />
      <span className="build-chat-activity-label">{statusLabel}</span>
      <span
        className="build-chat-activity-timer"
        data-testid="build-chat-activity-timer"
      >
        {formatElapsedDuration(elapsedSeconds)}
      </span>
    </div>
  );
}

export function ChatView(props: { state: BuildChatViewState }) {
  const {
    run,
    chatDraft,
    setChatDraft,
    chatSending,
    chatError,
    setChatError,
    optimisticUser,
    setOptimisticUser,
    streamingAssistant,
    stopChat,
    sendMessage,
  } = props.state;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const display = run.displayMessages ?? [];
  const activityState = deriveBuildChatActivityState({
    runStatus: run.status,
    chatSending,
    display,
    streamingAssistant,
    runId: run.id,
  });

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    run.displayMessages?.length ?? run.messages.length,
    optimisticUser?.id,
    optimisticUser?.text,
    streamingAssistant?.runId,
    streamingAssistant?.turn,
    streamingAssistant?.text,
  ]);

  useEffect(() => {
    if (run.status === "error" && run.error) {
      console.error("[build-bot] run error (state)", run.error);
    }
  }, [run.status, run.error]);

  useEffect(() => {
    if (chatSending || run.status === "running") return;
    composerInputRef.current?.focus();
  }, [chatSending, run.status]);

  const canStartAssistant = run.status !== "running" && !chatSending &&
    run.messages.length === 0;

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

  const handleStopChat = useCallback(async () => {
    try {
      await stopChat();
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    }
  }, [setChatError, stopChat]);

  return (
    <div className="test-bot-sidebar flex-column gap-8 flex-1 build-chat-panel">
      <div className="test-bot-thread">
        <div className="imessage-thread" ref={transcriptRef}>
          <div className="placeholder">
            Use this chat to update deck files via Gambit Bot. Tool calls show
            file writes and why they happened.
          </div>
          {(run.displayMessages?.length ?? 0) === 0 &&
            !optimisticUser &&
            !(streamingAssistant?.runId === run.id &&
              streamingAssistant.text.length > 0) &&
            <div className="placeholder">No messages yet.</div>}
          <BuildChatRows display={display} />
          {optimisticUser && (
            <div
              key={`optimistic-${optimisticUser.id}`}
              className="imessage-row right"
            >
              <div className="imessage-bubble right" title="user">
                <div
                  className="bubble-text"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(optimisticUser.text),
                  }}
                />
              </div>
            </div>
          )}
          {streamingAssistant &&
            streamingAssistant.runId === run.id &&
            streamingAssistant.text.length > 0 && (
            <div
              key={`stream-${streamingAssistant.runId}-${streamingAssistant.turn}`}
              className="imessage-row left"
            >
              <div className="imessage-bubble left" title="assistant">
                <div
                  className="bubble-text"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(streamingAssistant.text),
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="composer">
        <div className="composer-inputs">
          <div className="build-chat-activity-sticky">
            <BuildChatActivityIndicator state={activityState} />
          </div>
          {canStartAssistant && (
            <div className="placeholder emphasis">
              Start the assistant to begin editing.
            </div>
          )}
          <div className="flex-row gap-4 mb-2">
            <textarea
              ref={composerInputRef}
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
              {run.status === "running"
                ? (
                  <Button
                    variant="ghost"
                    onClick={handleStopChat}
                    disabled={chatSending}
                    data-testid="build-stop"
                  >
                    Stop
                  </Button>
                )
                : canStartAssistant
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
                    disabled={chatSending || chatDraft.trim().length === 0}
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

export default function Chat() {
  return <ChatView state={useBuildChat()} />;
}
