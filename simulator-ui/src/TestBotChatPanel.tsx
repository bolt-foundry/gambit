import React, { useEffect, useMemo, useRef } from "react";
import {
  type BuildDisplayMessage,
  buildTestPath,
  countUserMessages,
  deriveReasoningByAssistant,
  formatJson,
  summarizeToolCalls,
  type TestBotRun,
  type TraceEvent,
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
  activeWorkspaceId: string | null;
  requestedRunNotFound: boolean;
  canStart: boolean;
  canRunPersona: boolean;
  hasPersonaSelection: boolean;
  botJsonErrorCount: number;
  deckJsonErrorCount: number;
  missingBotInput: string[];
  missingDeckInit: string[];
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
  onAddScenarioErrorToWorkbench?: (
    payload: { workspaceId?: string; runId?: string; error: string },
  ) => void;
};

export default function TestBotChatPanel(props: Props) {
  const {
    run,
    runWorkspaceId,
    runStatusLabel,
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
    onAddScenarioErrorToWorkbench,
  } = props;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const lastRunMessageCountRef = useRef(0);

  useEffect(() => {
    lastRunMessageCountRef.current = 0;
  }, [run.id]);

  const toolCallSummaries = useMemo(
    () => summarizeToolCalls(run.traces ?? []),
    [run.traces],
  );
  const reasoningByAssistant = useMemo(
    () => deriveReasoningByAssistant(run.traces),
    [run.traces],
  );

  const toolBuckets = useMemo(() => {
    const deriveInsertsFromTraces = (
      traces: TraceEvent[],
      messageCount: number,
    ) => {
      const inserts: Array<{
        runId?: string;
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
          const runId = typeof traceRecord.runId === "string"
            ? traceRecord.runId
            : undefined;
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
            runId,
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
    const callKey = (runId: string | undefined, actionCallId: string) =>
      `${runId ?? ""}:${actionCallId}`;
    const inserts = traceInserts.length > 0 ? traceInserts : run.toolInserts ??
      [];
    inserts.forEach((insert) => {
      if (
        typeof insert?.index === "number" &&
        insert.index >= 0 &&
        insert.actionCallId
      ) {
        const insertRunId = typeof (insert as { runId?: unknown }).runId ===
            "string"
          ? (insert as { runId?: string }).runId
          : undefined;
        insertMap.set(callKey(insertRunId, insert.actionCallId), {
          index: insert.index,
          name: insert.name ?? undefined,
          parentActionCallId: insert.parentActionCallId ?? undefined,
        });
      }
    });
    for (const call of toolCallSummaries) {
      const insert = call.actionCallId
        ? insertMap.get(callKey(call.runId, call.actionCallId))
        : undefined;
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

  const testChatDisplay = useMemo(() => {
    const entries: BuildDisplayMessage[] = [];
    const pushToolBucket = (index: number) => {
      const bucket = toolBuckets.get(index);
      if (!bucket || bucket.length === 0) return;
      bucket.forEach((call, callIndex) => {
        entries.push({
          kind: "tool",
          toolCallId: call.id || call.actionCallId ||
            `tool-${index}-${callIndex}`,
          toolSummary: call,
        });
      });
    };
    const pushReasoningBucket = (assistantIndex: number) => {
      const bucket = reasoningByAssistant.get(assistantIndex);
      if (!bucket || bucket.length === 0) return;
      bucket.forEach((detail, detailIndex) => {
        const reasoningRaw = detail.event &&
            typeof detail.event === "object" &&
            !Array.isArray(detail.event)
          ? detail.event as Record<string, unknown>
          : undefined;
        entries.push({
          kind: "reasoning",
          reasoningId: `${assistantIndex}-${detailIndex}`,
          content: detail.text,
          reasoningRaw,
        });
      });
    };

    pushToolBucket(0);
    let assistantIndex = -1;
    run.messages.forEach((message, messageIndex) => {
      if (message.role === "assistant") {
        assistantIndex += 1;
        pushReasoningBucket(assistantIndex);
      }
      entries.push({
        kind: "message",
        role: message.role === "user" ? "user" : "assistant",
        content: message.content,
      });
      pushToolBucket(messageIndex + 1);
    });

    return entries;
  }, [reasoningByAssistant, run.messages, toolBuckets]);

  useEffect(() => {
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
                onAddScenarioErrorToWorkbench?.({
                  workspaceId: runWorkspaceId ?? activeWorkspaceId ?? undefined,
                  runId: run.id,
                  error: run.error!,
                })}
              disabled={!onAddScenarioErrorToWorkbench}
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
          {run.messages.length === 0 && <Callout>No messages yet.</Callout>}
          <ActivityTranscriptRows
            key={`test-activity-${run.id ?? "unknown"}`}
            display={testChatDisplay}
            previewToolWhenNoReasoning
            renderMessage={(_, messageOrdinal) => {
              const message = run.messages[messageOrdinal];
              if (!message) return null;
              const messageKey = message.messageRefId ??
                `${message.role}-${messageOrdinal}`;
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
                            <Badge>gambit_respond</Badge>
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
                        onScore={onScore}
                        onReasonChange={onReasonChange}
                      />
                    )}
                  </div>
                </div>
              );
            }}
          />
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
