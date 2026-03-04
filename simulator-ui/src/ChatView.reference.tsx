// LEGACY-ONLY, DO NOT USE. Retained for historical reference during GraphQL/Isograph cutover.
// deno-lint-ignore-file
import { useCallback, useEffect, useRef, useState } from "react";
import { classNames, renderMarkdown } from "./utils.ts";
import Button from "./gds/Button.tsx";
import Callout from "./gds/Callout.tsx";
import WorkbenchComposerChip from "./gds/WorkbenchComposerChip.tsx";
import {
  type BuildChatActivityState,
  BuildChatRows,
  type BuildChatViewState,
  deriveBuildChatActivityState,
  encodeWorkbenchMessageWithContext,
  formatElapsedDuration,
  type WorkbenchComposerChip as WorkbenchComposerChipState,
  type WorkbenchScenarioErrorChip,
} from "./Chat.tsx";

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
    setStartedAtMs((previous) => previous ?? Date.now());
    const handle = setInterval(() => setTick((previous) => previous + 1), 250);
    return () => clearInterval(handle);
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

function UserMessageContent(props: { content: string }) {
  const { content } = props;
  return (
    <div
      className="bubble-text"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}

export function ChatView(props: {
  state: BuildChatViewState;
  composerChips?: Array<WorkbenchComposerChipState>;
  onComposerChipsChange?: (next: Array<WorkbenchComposerChipState>) => void;
  scenarioErrorChip?: WorkbenchScenarioErrorChip | null;
  onScenarioErrorChipChange?: (next: WorkbenchScenarioErrorChip | null) => void;
}) {
  const {
    composerChips,
    onComposerChipsChange,
    scenarioErrorChip,
    onScenarioErrorChipChange,
  } = props;
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
  const resolvedComposerChips = composerChips ??
    (scenarioErrorChip
      ? [{
        ...scenarioErrorChip,
        chipId: "scenario_run_error",
      }]
      : []);
  const updateComposerChips = useCallback(
    (next: Array<WorkbenchComposerChipState>) => {
      if (onComposerChipsChange) {
        onComposerChipsChange(next);
        return;
      }
      if (!onScenarioErrorChipChange) return;
      const errorChip = next.find((chip) =>
        chip.source === "scenario_run_error"
      );
      if (!errorChip) {
        onScenarioErrorChipChange(null);
        return;
      }
      onScenarioErrorChipChange({
        source: "scenario_run_error",
        workspaceId: errorChip.workspaceId,
        runId: errorChip.runId,
        capturedAt: errorChip.capturedAt,
        error: errorChip.error,
        enabled: errorChip.enabled,
      });
    },
    [onComposerChipsChange, onScenarioErrorChipChange],
  );
  const hasEnabledComposerChip = resolvedComposerChips.some((chip) =>
    chip.enabled
  );
  const canSubmitMessage = !chatSending &&
    run.status !== "running" &&
    (chatDraft.trim().length > 0 || hasEnabledComposerChip);
  const showStartButton = canStartAssistant && chatDraft.trim().length === 0 &&
    !hasEnabledComposerChip;

  const handleSendChat = useCallback(async () => {
    const message = chatDraft.trim();
    const activeChips = resolvedComposerChips.filter((chip) => chip.enabled);
    const activeChipIds = new Set(activeChips.map((chip) => chip.chipId));
    const activeContexts = activeChips
      .map((chip) => {
        if (chip.source === "scenario_run_error") {
          return {
            source: "scenario_run_error" as const,
            workspaceId: chip.workspaceId,
            runId: chip.runId,
            capturedAt: chip.capturedAt,
            error: chip.error,
          };
        }
        if (chip.source === "message_rating") {
          return {
            source: "message_rating" as const,
            workspaceId: chip.workspaceId,
            runId: chip.runId,
            capturedAt: chip.capturedAt,
            messageRefId: chip.messageRefId,
            statePath: chip.statePath,
            statePointer: chip.statePointer,
            score: chip.score,
            reason: chip.reason,
          };
        }
        return {
          source: "grading_flag" as const,
          workspaceId: chip.workspaceId,
          runId: chip.runId,
          capturedAt: chip.capturedAt,
          flagId: chip.flagId,
          refId: chip.refId,
          score: chip.score,
          message: chip.message,
        };
      });
    if (!message && activeContexts.length === 0) return;
    const outboundMessage = activeContexts.length > 0
      ? encodeWorkbenchMessageWithContext(message, activeContexts)
      : message;
    setOptimisticUser({ id: crypto.randomUUID(), text: outboundMessage });
    setChatDraft("");
    try {
      await sendMessage(outboundMessage);
      if (activeChipIds.size > 0) {
        updateComposerChips(
          resolvedComposerChips.map((chip) =>
            activeChipIds.has(chip.chipId) ? { ...chip, enabled: false } : chip
          ),
        );
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptimisticUser(null);
    }
  }, [
    chatDraft,
    resolvedComposerChips,
    sendMessage,
    setChatDraft,
    setChatError,
    setOptimisticUser,
    updateComposerChips,
  ]);

  const handleStartAssistant = useCallback(async () => {
    if (chatDraft.trim().length > 0 || hasEnabledComposerChip) {
      await handleSendChat();
      return;
    }
    await sendMessage("");
  }, [chatDraft, handleSendChat, hasEnabledComposerChip, sendMessage]);

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
          <Callout>
            Use this chat to update deck files via Gambit Bot. Tool calls show
            file writes and why they happened.
          </Callout>
          {(run.displayMessages?.length ?? 0) === 0 &&
            !optimisticUser &&
            !(streamingAssistant?.runId === run.id &&
              streamingAssistant.text.length > 0) &&
            <Callout>No messages yet.</Callout>}
          <BuildChatRows display={display} />
          {optimisticUser && (
            <div
              key={`optimistic-${optimisticUser.id}`}
              className="imessage-row right"
            >
              <div className="imessage-bubble right" title="user">
                <UserMessageContent content={optimisticUser.text} />
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
          {resolvedComposerChips.length > 0 && (
            <div className="workbench-composer-chip-row">
              {resolvedComposerChips.map((chip) => (
                <WorkbenchComposerChip
                  key={chip.chipId}
                  context={chip}
                  enabled={chip.enabled}
                  onEnabledChange={(enabled) =>
                    updateComposerChips(
                      resolvedComposerChips.map((entry) =>
                        entry.chipId === chip.chipId
                          ? { ...entry, enabled }
                          : entry
                      ),
                    )}
                  onRemove={() =>
                    updateComposerChips(
                      resolvedComposerChips.filter((entry) =>
                        entry.chipId !== chip.chipId
                      ),
                    )}
                />
              ))}
            </div>
          )}
          {showStartButton && (
            <Callout variant="emphasis">
              Start the assistant to begin editing.
            </Callout>
          )}
          <div className="flex-row gap-4 mb-2">
            <textarea
              ref={composerInputRef}
              className="message-input flex-1"
              rows={1}
              placeholder={showStartButton
                ? "Start the assistant to begin..."
                : "Message Gambit Bot..."}
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              disabled={chatSending || run.status === "running"}
              data-testid="build-chat-input"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSubmitMessage) {
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
                : showStartButton
                ? (
                  <Button
                    variant="primary"
                    onClick={handleStartAssistant}
                    disabled={!showStartButton}
                    data-testid="build-start"
                  >
                    Start
                  </Button>
                )
                : (
                  <Button
                    variant="primary"
                    onClick={handleSendChat}
                    disabled={!canSubmitMessage}
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
