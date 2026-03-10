// @ts-nocheck
// deno-lint-ignore-file
import React, { useEffect, useRef } from "react";
import {
  type BuildDisplayMessage,
  buildTestPath,
  countUserMessages,
  formatJson,
  type TestBotRun,
} from "./utils.ts";
import type { FeedbackEntry } from "./utils.ts";
import { FeedbackControls } from "./shared.tsx";
import { ActivityTranscriptRows } from "./ActivityTranscriptRows.tsx";
import Panel from "./gds/Panel.tsx";
import Button from "./gds/Button.tsx";
import Badge from "./gds/Badge.tsx";
import Callout from "./gds/Callout.tsx";

type Props = {
  run: TestBotRun;
  runWorkspaceId?: string;
  runStatusLabel: string;
  testChatDisplay: Array<BuildDisplayMessage>;
  transcriptMessageCount?: number;
  transcriptUserMessageCount?: number;
  activeWorkspaceId: string | null;
  requestedRunNotFound: boolean;
  canStart: boolean;
  canRunPersona: boolean;
  hasPersonaSelection: boolean;
  botJsonErrorCount: number;
  deckJsonErrorCount: number;
  missingBotInput: Array<string>;
  missingDeckInit: Array<string>;
  lastInitFill: TestBotRun["initFill"] | null;
  isUserStart: boolean;
  showStartOverlay: boolean;
  canStartAssistant: boolean;
  canSendChat: boolean;
  chatDraft: string;
  setChatDraft: React.Dispatch<React.SetStateAction<string>>;
  chatError: string | null;
  optimisticUser: { id: string; text: string } | null;
  streamingUser: {
    runId: string;
    turn: number;
    text: string;
    expectedUserCount?: number;
  } | null;
  streamingAssistant: { runId: string; turn: number; text: string } | null;
  startRun: () => Promise<void>;
  stopRun: () => Promise<void>;
  handleNewChat: () => Promise<void>;
  handleSendChat: () => Promise<void>;
  handleStartAssistant: () => Promise<void>;
  onScore: (
    messageRefId: string,
    score: number | null,
    reason?: string,
  ) => void | Promise<void>;
  onReasonChange: (
    messageRefId: string,
    score: number,
    reason: string,
  ) => void | Promise<void>;
  onAddErrorToWorkbench?: (
    payload: {
      source?: "scenario_run_error" | "grader_run_error";
      workspaceId?: string;
      runId?: string;
      error: string;
    },
  ) => void;
  onAddFeedbackToWorkbench?: (feedback: FeedbackEntry) => void;
};

export default function TestBotChatPanel(props: Props) {
  const {
    run,
    runWorkspaceId,
    runStatusLabel,
    testChatDisplay,
    transcriptMessageCount,
    transcriptUserMessageCount,
    activeWorkspaceId,
    requestedRunNotFound,
    canStart,
    canRunPersona,
    hasPersonaSelection,
    botJsonErrorCount,
    deckJsonErrorCount,
    missingBotInput,
    missingDeckInit,
    lastInitFill,
    isUserStart,
    showStartOverlay,
    canStartAssistant,
    canSendChat,
    chatDraft,
    setChatDraft,
    chatError,
    optimisticUser,
    streamingUser,
    streamingAssistant,
    startRun,
    stopRun,
    handleNewChat,
    handleSendChat,
    handleStartAssistant,
    onScore,
    onReasonChange,
    onAddErrorToWorkbench,
    onAddFeedbackToWorkbench,
  } = props;
  const resolvedMessageCount = transcriptMessageCount ?? run.messages.length;
  const resolvedUserMessageCount = transcriptUserMessageCount ??
    countUserMessages(run.messages);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const lastTranscriptDisplayCountRef = useRef(0);

  useEffect(() => {
    lastTranscriptDisplayCountRef.current = 0;
  }, [run.id]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const shouldScroll = testChatDisplay.length >
        lastTranscriptDisplayCountRef.current ||
      Boolean(streamingUser?.text || streamingAssistant?.text);
    lastTranscriptDisplayCountRef.current = testChatDisplay.length;
    if (!shouldScroll) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    run.id,
    testChatDisplay.length,
    streamingUser,
    streamingAssistant?.text,
  ]);

  return (
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
      {requestedRunNotFound && activeWorkspaceId && (
        <Callout>
          Test run not found for this workspace.{" "}
          <a href={buildTestPath(activeWorkspaceId)}>Back to test runs</a>
        </Callout>
      )}
      {run.status === "error" && run.error && (
        <Callout
          variant="danger"
          title="Scenario run failed"
          actions={
            <Button
              variant="secondary"
              size="small"
              onClick={() =>
                onAddErrorToWorkbench?.({
                  source: "scenario_run_error",
                  workspaceId: runWorkspaceId ?? activeWorkspaceId ?? undefined,
                  runId: run.id,
                  error: run.error!,
                })}
              disabled={!onAddErrorToWorkbench}
              data-testid="testbot-add-error-to-chat"
            >
              Add to chat
            </Button>
          }
          data-testid="testbot-error-callout"
        >
          {run.error}
        </Callout>
      )}
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
        <Callout>
          Missing required init fields will be requested from the persona:{" "}
          {missingDeckInit.slice(0, 6).join(", ")}
          {missingDeckInit.length > 6 ? "…" : ""}
        </Callout>
      )}
      <div className="test-bot-thread">
        <div
          className="imessage-thread"
          ref={transcriptRef}
        >
          {testChatDisplay.length === 0 && <Callout>No messages yet.</Callout>}
          <ActivityTranscriptRows
            key={`test-activity-${run.id ?? "unknown"}`}
            display={testChatDisplay}
            previewToolWhenNoReasoning
            renderMessage={(entry, messageOrdinal) => {
              const fallbackMessage = run.messages[messageOrdinal];
              if (!entry && !fallbackMessage) return null;
              const message = {
                id: entry.id ?? fallbackMessage?.messageRefId ?? null,
                role: entry.role ?? fallbackMessage?.role ?? "assistant",
                content: entry.content ?? fallbackMessage?.content ?? "",
                messageRefId: entry.messageRefId ??
                  fallbackMessage?.messageRefId,
                feedbackEligible: entry.feedbackEligible ??
                  fallbackMessage?.feedbackEligible ?? false,
                feedback: entry.feedback ?? fallbackMessage?.feedback,
                respondStatus: fallbackMessage?.respondStatus,
                respondCode: fallbackMessage?.respondCode,
                respondMessage: fallbackMessage?.respondMessage,
                respondPayload: fallbackMessage?.respondPayload,
                respondMeta: fallbackMessage?.respondMeta,
              };
              const messageKey = message.messageRefId
                ? `${message.messageRefId}-${messageOrdinal}`
                : message.id
                ? `${message.id}-${messageOrdinal}`
                : `${message.role}-${messageOrdinal}`;
              const hasRespondPayload = message.respondPayload !== undefined ||
                message.respondMeta !== undefined ||
                typeof message.respondStatus === "number" ||
                typeof message.respondMessage === "string" ||
                typeof message.respondCode === "string";
              return (
                <div
                  key={messageKey}
                  className={`imessage-row ${
                    message.role === "user" ? "right" : "left"
                  }`}
                >
                  <div
                    className={`imessage-bubble ${
                      message.role === "user" ? "right" : "left"
                    }`}
                    title={message.role}
                  >
                    {hasRespondPayload
                      ? (
                        <div className="respond-summary">
                          <div className="respond-meta">
                            <Badge>legacy respond envelope</Badge>
                            {typeof message.respondStatus === "number" && (
                              <Badge variant="ghost">
                                status {message.respondStatus}
                              </Badge>
                            )}
                            {message.respondCode && (
                              <Badge variant="ghost">
                                code {message.respondCode}
                              </Badge>
                            )}
                          </div>
                          {message.respondMessage && (
                            <div className="respond-message">
                              {message.respondMessage}
                            </div>
                          )}
                          {message.respondPayload !== undefined && (
                            <pre className="bubble-json">
                              {formatJson(message.respondPayload)}
                            </pre>
                          )}
                          {message.respondMeta && (
                            <details className="respond-meta-details">
                              <summary>Meta</summary>
                              <pre className="bubble-json">
                                {formatJson(message.respondMeta)}
                              </pre>
                            </details>
                          )}
                        </div>
                      )
                      : message.content}
                    {message.messageRefId && runWorkspaceId && (
                      <FeedbackControls
                        messageRefId={message.messageRefId}
                        feedback={message.feedback as FeedbackEntry | undefined}
                        disabled={!message.feedbackEligible}
                        onScore={onScore}
                        onReasonChange={onReasonChange}
                        onAddToWorkbench={onAddFeedbackToWorkbench}
                      />
                    )}
                  </div>
                </div>
              );
            }}
          />
          {streamingUser?.text && streamingUser.runId === run.id &&
            (streamingUser.expectedUserCount === undefined ||
              resolvedUserMessageCount < streamingUser.expectedUserCount) &&
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
            {isUserStart && resolvedMessageCount === 0 &&
              !streamingAssistant?.text && !streamingUser?.text && (
              <Callout variant="emphasis">
                This deck expects a user message to kick things off.
              </Callout>
            )}
            <div className="flex-row gap-4 mb-2">
              <textarea
                className="message-input flex-1"
                rows={1}
                placeholder={showStartOverlay
                  ? "Start the assistant to begin..."
                  : isUserStart && resolvedMessageCount === 0
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
              <Callout className="test-bot-thread-subtitle">
                Pick the flow you want: manual conversation or a full scenario
                run.
              </Callout>
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
                    Run scenario
                  </div>
                  <div className="test-bot-thread-section-body">
                    Run the configured scenario to execute end-to-end
                    validations.
                  </div>
                  <Button
                    variant="primary"
                    onClick={startRun}
                    disabled={!canStart}
                    data-testid="testbot-run-overlay"
                  >
                    Run scenario
                  </Button>
                </div>
              </div>
              {chatError && <div className="error">{chatError}</div>}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
