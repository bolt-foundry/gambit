import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  type BuildDisplayMessage,
  classNames,
  renderMarkdown,
} from "./utils.ts";
import Button from "./gds/Button.tsx";
import Callout from "./gds/Callout.tsx";
import Icon from "./gds/Icon.tsx";
import WorkbenchComposerChip from "./gds/WorkbenchComposerChip.tsx";
import {
  ActivityTranscriptRows,
  bucketBuildChatDisplay,
} from "./ActivityTranscriptRows.tsx";
import { useBuildChat } from "./BuildChatContext.tsx";

export { bucketBuildChatDisplay };

export type WorkbenchScenarioErrorContext = {
  source: "scenario_run_error";
  workspaceId?: string;
  runId?: string;
  capturedAt: string;
  error: string;
};

export type WorkbenchRatingContext = {
  source: "message_rating";
  workspaceId?: string;
  runId?: string;
  capturedAt: string;
  messageRefId: string;
  statePath?: string;
  statePointer?: string;
  score: number;
  reason?: string;
};

export type WorkbenchFlagContext = {
  source: "grading_flag";
  workspaceId?: string;
  runId?: string;
  capturedAt: string;
  flagId?: string;
  refId: string;
  score?: number;
  message: string;
};

export type WorkbenchMessageContext =
  | WorkbenchScenarioErrorContext
  | WorkbenchRatingContext
  | WorkbenchFlagContext;

export type WorkbenchScenarioErrorChip = WorkbenchScenarioErrorContext & {
  enabled: boolean;
};

export type WorkbenchComposerChip = WorkbenchMessageContext & {
  chipId: string;
  enabled: boolean;
};

const ERROR_CONTEXT_START_MARKER = "[gambit:error-context/v1]";
const ERROR_CONTEXT_END_MARKER = "[/gambit:error-context/v1]";
const WORKBENCH_CONTEXT_START_MARKER = "[gambit:workbench-context/v2]";
const WORKBENCH_CONTEXT_END_MARKER = "[/gambit:workbench-context/v2]";

function parseWorkbenchContext(value: unknown): WorkbenchMessageContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.capturedAt !== "string" ||
    record.capturedAt.trim().length === 0
  ) {
    return null;
  }
  const workspaceId = typeof record.workspaceId === "string"
    ? record.workspaceId
    : undefined;
  const runId = typeof record.runId === "string" ? record.runId : undefined;

  if (record.source === "scenario_run_error") {
    if (typeof record.error !== "string" || record.error.trim().length === 0) {
      return null;
    }
    return {
      source: "scenario_run_error",
      workspaceId,
      runId,
      capturedAt: record.capturedAt,
      error: record.error,
    };
  }
  if (record.source === "message_rating") {
    if (
      typeof record.score !== "number" || !Number.isFinite(record.score) ||
      typeof record.messageRefId !== "string" ||
      record.messageRefId.trim().length === 0
    ) {
      return null;
    }
    return {
      source: "message_rating",
      workspaceId,
      runId,
      capturedAt: record.capturedAt,
      messageRefId: record.messageRefId,
      statePath: typeof record.statePath === "string"
        ? record.statePath
        : undefined,
      statePointer: typeof record.statePointer === "string"
        ? record.statePointer
        : undefined,
      score: record.score,
      reason: typeof record.reason === "string" ? record.reason : undefined,
    };
  }
  if (record.source === "grading_flag") {
    if (
      typeof record.refId !== "string" || record.refId.trim().length === 0 ||
      typeof record.message !== "string" || record.message.trim().length === 0
    ) {
      return null;
    }
    return {
      source: "grading_flag",
      workspaceId,
      runId,
      capturedAt: record.capturedAt,
      flagId: typeof record.flagId === "string" ? record.flagId : undefined,
      refId: record.refId,
      score: typeof record.score === "number" && Number.isFinite(record.score)
        ? record.score
        : undefined,
      message: record.message,
    };
  }
  return null;
}

function decodeLegacyWorkbenchErrorContext(content: string): {
  context: WorkbenchScenarioErrorContext;
  body: string;
} | null {
  if (typeof content !== "string") return null;
  if (!content.startsWith(`${ERROR_CONTEXT_START_MARKER}\n`)) return null;
  const endMarkerIndex = content.indexOf(`\n${ERROR_CONTEXT_END_MARKER}`);
  if (endMarkerIndex < 0) return null;
  const jsonStart = ERROR_CONTEXT_START_MARKER.length + 1;
  const jsonRaw = content.slice(jsonStart, endMarkerIndex).trim();
  if (!jsonRaw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonRaw);
  } catch {
    return null;
  }
  const context = parseWorkbenchContext(parsed);
  if (!context || context.source !== "scenario_run_error") {
    return null;
  }
  const markerEndIndex = endMarkerIndex +
    `\n${ERROR_CONTEXT_END_MARKER}`.length;
  const remainder = content.slice(markerEndIndex);
  const body = remainder.startsWith("\n") ? remainder.slice(1) : remainder;
  return {
    context,
    body,
  };
}

export function encodeWorkbenchMessageWithErrorContext(
  message: string,
  context: WorkbenchScenarioErrorContext,
): string {
  return `${ERROR_CONTEXT_START_MARKER}\n${
    JSON.stringify(context)
  }\n${ERROR_CONTEXT_END_MARKER}${message.trim() ? `\n${message.trim()}` : ""}`;
}

export function encodeWorkbenchMessageWithContext(
  message: string,
  contexts: WorkbenchMessageContext[],
): string {
  const body = message.trim();
  const encodedContexts = contexts.filter((context) =>
    parseWorkbenchContext(context)
  );
  if (encodedContexts.length === 0) return body;
  return `${WORKBENCH_CONTEXT_START_MARKER}\n${
    JSON.stringify(encodedContexts)
  }\n${WORKBENCH_CONTEXT_END_MARKER}${body ? `\n${body}` : ""}`;
}

export function decodeWorkbenchMessageWithErrorContext(content: string): {
  context: WorkbenchScenarioErrorContext;
  body: string;
} | null {
  const decoded = decodeWorkbenchMessageWithContext(content);
  if (decoded) {
    const errorContext = decoded.contexts.find((context) =>
      context.source === "scenario_run_error"
    );
    if (!errorContext) return null;
    return { context: errorContext, body: decoded.body };
  }
  return decodeLegacyWorkbenchErrorContext(content);
}

export function decodeWorkbenchMessageWithContext(content: string): {
  contexts: WorkbenchMessageContext[];
  body: string;
} | null {
  if (typeof content !== "string") return null;
  if (!content.startsWith(`${WORKBENCH_CONTEXT_START_MARKER}\n`)) {
    const legacyDecoded = decodeLegacyWorkbenchErrorContext(content);
    if (!legacyDecoded) return null;
    return { contexts: [legacyDecoded.context], body: legacyDecoded.body };
  }
  const endMarkerIndex = content.indexOf(`\n${WORKBENCH_CONTEXT_END_MARKER}`);
  if (endMarkerIndex < 0) return null;
  const jsonStart = WORKBENCH_CONTEXT_START_MARKER.length + 1;
  const jsonRaw = content.slice(jsonStart, endMarkerIndex).trim();
  if (!jsonRaw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonRaw);
  } catch {
    return null;
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const contexts = records.map((record) => parseWorkbenchContext(record))
    .filter((context): context is WorkbenchMessageContext => Boolean(context));
  if (contexts.length === 0) return null;
  const markerEndIndex = endMarkerIndex +
    `\n${WORKBENCH_CONTEXT_END_MARKER}`.length;
  const remainder = content.slice(markerEndIndex);
  const body = remainder.startsWith("\n") ? remainder.slice(1) : remainder;
  return {
    contexts,
    body,
  };
}

function UserMessageContent(props: { content: string }) {
  const { content } = props;
  const decoded = decodeWorkbenchMessageWithContext(content);
  const body = decoded ? decoded.body : content;
  const showBody = body.trim().length > 0;
  return (
    <>
      {decoded && (
        <div className="workbench-transcript-chip-row">
          {decoded.contexts.map((context, index) => (
            <WorkbenchComposerChip
              key={`${context.source}-${index}`}
              className="workbench-context-chip--transcript"
              context={context}
              testId={context.source === "scenario_run_error"
                ? "workbench-transcript-error-chip"
                : undefined}
            />
          ))}
        </div>
      )}
      {showBody && (
        <div
          className="bubble-text"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
        />
      )}
    </>
  );
}

export function BuildChatRows(props: { display: BuildDisplayMessage[] }) {
  const { display } = props;
  return (
    <ActivityTranscriptRows
      display={display}
      renderMessage={(entry, messageOrdinal) => {
        const role = entry.role ?? "assistant";
        const content = entry.content ?? "";
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
              {role === "user" ? <UserMessageContent content={content} /> : (
                <div
                  className="bubble-text"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
                />
              )}
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

export function ChatView(props: {
  state: BuildChatViewState;
  composerChips?: WorkbenchComposerChip[];
  onComposerChipsChange?: (next: WorkbenchComposerChip[]) => void;
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
  const updateComposerChips = useCallback((next: WorkbenchComposerChip[]) => {
    if (onComposerChipsChange) {
      onComposerChipsChange(next);
      return;
    }
    if (!onScenarioErrorChipChange) return;
    const errorChip = next.find((chip) => chip.source === "scenario_run_error");
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
  }, [onComposerChipsChange, onScenarioErrorChipChange]);
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

export default function Chat(props: {
  composerChips?: WorkbenchComposerChip[];
  onComposerChipsChange?: (next: WorkbenchComposerChip[]) => void;
  scenarioErrorChip?: WorkbenchScenarioErrorChip | null;
  onScenarioErrorChipChange?: (next: WorkbenchScenarioErrorChip | null) => void;
}) {
  const {
    composerChips,
    onComposerChipsChange,
    scenarioErrorChip,
    onScenarioErrorChipChange,
  } = props;
  return (
    <ChatView
      state={useBuildChat()}
      composerChips={composerChips}
      onComposerChipsChange={onComposerChipsChange}
      scenarioErrorChip={scenarioErrorChip}
      onScenarioErrorChipChange={onScenarioErrorChipChange}
    />
  );
}
