import { iso } from "@iso-gambit-sim";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type BuildChatActivityState,
  BuildChatRows,
  deriveBuildChatActivityState,
  formatElapsedDuration,
} from "../../../src/Chat.tsx";
import Button from "../../../src/gds/Button.tsx";
import Callout from "../../../src/gds/Callout.tsx";
import CodexLoginRequiredOverlay from "../../../src/CodexLoginRequiredOverlay.tsx";
import type {
  BuildDisplayMessage,
  ToolCallSummary,
} from "../../../src/utils.ts";
import WorkbenchDrawerIso, {
  type WorkbenchChatMessage,
  type WorkbenchChatRunStatus,
} from "../../../src/WorkbenchDrawerIso.tsx";

const RUN_STATUS_VALUES = new Set<WorkbenchChatRunStatus>([
  "IDLE",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELED",
]);

function isBuildChatDebugEnabled(): boolean {
  if (typeof globalThis === "undefined") return false;
  const debugGlobal = (globalThis as { __GAMBIT_BUILD_CHAT_DEBUG__?: unknown })
    .__GAMBIT_BUILD_CHAT_DEBUG__;
  if (debugGlobal === true) return true;
  const search = typeof globalThis.location?.search === "string"
    ? globalThis.location.search
    : "";
  if (search.length > 0) {
    const value = new URLSearchParams(search).get("gambitBuildChatDebug");
    if (value === "1" || value === "true") return true;
  }
  if (typeof globalThis.localStorage === "undefined") return false;
  const stored = (globalThis.localStorage.getItem("gambit:build-chat-debug") ??
    "").toLowerCase().trim();
  return stored === "1" || stored === "true" || stored === "yes";
}

const BUILD_CHAT_DEBUG = isBuildChatDebugEnabled();

function logBuildChatDebug(
  event: string,
  payload: Record<string, unknown>,
): void {
  if (!BUILD_CHAT_DEBUG) return;
  void event;
  void payload;
}

function toRunStatus(value: unknown): WorkbenchChatRunStatus {
  if (typeof value !== "string") return "IDLE";
  return RUN_STATUS_VALUES.has(value as WorkbenchChatRunStatus)
    ? (value as WorkbenchChatRunStatus)
    : "IDLE";
}

function toMessageRole(value: unknown): "user" | "assistant" {
  return value === "user" ? "user" : "assistant";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "GraphQL request failed";
}

type OptimisticOutputEdge = {
  node: {
    __typename: "OutputMessage";
    asOutputMessage: {
      id: string;
      role: "user" | "assistant";
      content: string;
    };
  };
};

function toOptimisticOutputEdges(
  messages: Array<WorkbenchChatMessage>,
): Array<OptimisticOutputEdge> {
  return messages.map((message, index) => ({
    node: {
      __typename: "OutputMessage",
      asOutputMessage: {
        id: message.id ?? `optimistic-message-existing-${index}`,
        role: message.role,
        content: message.content,
      },
    },
  }));
}

function toToolStatus(
  value: unknown,
): ToolCallSummary["status"] {
  if (value === "COMPLETED") return "completed";
  if (value === "ERROR") return "error";
  if (value === "RUNNING") return "running";
  return "pending";
}

function toOutputDisplayEntries(
  outputItems: Array<unknown>,
): {
  messages: Array<WorkbenchChatMessage>;
  display: Array<BuildDisplayMessage>;
} {
  const messages: Array<WorkbenchChatMessage> = [];
  const display: Array<BuildDisplayMessage> = [];
  for (const item of outputItems) {
    if (!item || typeof item !== "object") continue;
    const node = item as Record<string, unknown>;
    const typeName = typeof node.__typename === "string" ? node.__typename : "";
    if (typeName === "OutputMessage") {
      const outputMessage = node.asOutputMessage &&
          typeof node.asOutputMessage === "object"
        ? node.asOutputMessage as Record<string, unknown>
        : null;
      const content = outputMessage && typeof outputMessage.content === "string"
        ? outputMessage.content
        : "";
      if (content.length === 0) continue;
      const role = toMessageRole(outputMessage?.role);
      const message = {
        id: typeof outputMessage?.id === "string"
          ? outputMessage.id
          : undefined,
        role,
        content,
      };
      messages.push(message);
      display.push({
        kind: "message",
        role,
        content,
      });
      continue;
    }
    if (typeName === "OutputReasoning") {
      const outputReasoning = node.asOutputReasoning &&
          typeof node.asOutputReasoning === "object"
        ? node.asOutputReasoning as Record<string, unknown>
        : null;
      if (!outputReasoning || typeof outputReasoning.summary !== "string") {
        continue;
      }
      display.push({
        kind: "reasoning",
        reasoningId: typeof outputReasoning.id === "string"
          ? outputReasoning.id
          : undefined,
        content: outputReasoning.summary,
        reasoningType: typeof outputReasoning.reasoningType === "string"
          ? outputReasoning.reasoningType
          : undefined,
      });
      continue;
    }
    if (typeName === "OutputToolCall") {
      const outputToolCall = node.asOutputToolCall &&
          typeof node.asOutputToolCall === "object"
        ? node.asOutputToolCall as Record<string, unknown>
        : null;
      if (!outputToolCall) continue;
      const toolCallId = typeof outputToolCall.toolCallId === "string"
        ? outputToolCall.toolCallId
        : undefined;
      const itemId = typeof outputToolCall.id === "string"
        ? outputToolCall.id
        : toolCallId;
      if (!itemId) continue;
      display.push({
        kind: "tool",
        toolCallId,
        toolSummary: {
          key: itemId,
          id: itemId,
          actionCallId: toolCallId,
          name: typeof outputToolCall.toolName === "string"
            ? outputToolCall.toolName
            : undefined,
          status: toToolStatus(outputToolCall.status),
          args: typeof outputToolCall.argumentsText === "string"
            ? outputToolCall.argumentsText
            : undefined,
          result: typeof outputToolCall.resultText === "string"
            ? outputToolCall.resultText
            : undefined,
          error: typeof outputToolCall.error === "string"
            ? outputToolCall.error
            : undefined,
        },
      });
    }
  }
  const outputTypeCounts: Record<string, number> = {};
  for (const item of outputItems) {
    if (!item || typeof item !== "object") continue;
    const key =
      typeof (item as { __typename?: unknown }).__typename === "string"
        ? String((item as { __typename: unknown }).__typename)
        : "unknown";
    outputTypeCounts[key] = (outputTypeCounts[key] ?? 0) + 1;
  }
  const displayTypeCounts: Record<string, number> = {};
  for (const entry of display) {
    displayTypeCounts[entry.kind] = (displayTypeCounts[entry.kind] ?? 0) + 1;
  }
  logBuildChatDebug("drawer.toOutputDisplayEntries", {
    outputCount: outputItems.length,
    outputTypeCounts,
    displayCount: display.length,
    displayTypeCounts,
    messageCount: messages.length,
  });
  return { messages, display };
}

function toBuildChatRunStatus(
  status: WorkbenchChatRunStatus,
): "idle" | "running" | "completed" | "error" | "canceled" {
  switch (status) {
    case "RUNNING":
      return "running";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "error";
    case "CANCELED":
      return "canceled";
    default:
      return "idle";
  }
}

function BuildChatActivityIndicator(props: {
  state: BuildChatActivityState;
  startedAtMs?: number | null;
  testId?: string;
  timerTestId?: string;
}) {
  const { state } = props;
  const active = state === "Thinking" || state === "Responding";
  const localStartedAtMsRef = useRef<number | null>(null);
  const [tick, incrementTick] = useReducer(
    (previous: number) => previous + 1,
    0,
  );

  useEffect(() => {
    if (!active) {
      localStartedAtMsRef.current = null;
      return;
    }
    if (typeof props.startedAtMs !== "number") {
      localStartedAtMsRef.current = localStartedAtMsRef.current ?? Date.now();
    } else {
      localStartedAtMsRef.current = null;
    }
    const handle = setInterval(() => incrementTick(), 250);
    return () => clearInterval(handle);
  }, [active, props.startedAtMs]);

  if (!active) return null;

  const startedAtMs = typeof props.startedAtMs === "number"
    ? props.startedAtMs
    : localStartedAtMsRef.current ?? Date.now();
  const elapsedSeconds = !Number.isFinite(startedAtMs)
    ? 0
    : Math.floor((Date.now() - startedAtMs) / 1000);
  const statusLabel = state === "Thinking"
    ? "Assistant is thinking"
    : "Assistant is responding";
  const indicatorClassName = [
    "build-chat-activity-indicator",
    state === "Thinking"
      ? "build-chat-activity-indicator-thinking"
      : "build-chat-activity-indicator-responding",
  ].join(" ");

  return (
    <div
      className={indicatorClassName}
      role="status"
      aria-live="polite"
      data-testid={props.testId ?? "build-chat-activity-indicator"}
      data-activity-state={state}
      data-activity-tick={tick}
    >
      <span className="build-chat-activity-glimmer" aria-hidden="true" />
      <span className="build-chat-activity-spinner" aria-hidden="true" />
      <span className="build-chat-activity-label">{statusLabel}</span>
      <span
        className="build-chat-activity-timer"
        data-testid={props.timerTestId ?? "build-chat-activity-timer"}
      >
        {formatElapsedDuration(elapsedSeconds)}
      </span>
    </div>
  );
}

function isNearBottom(element: HTMLElement, thresholdPx = 48): boolean {
  const delta = element.scrollHeight - element.scrollTop - element.clientHeight;
  return delta <= thresholdPx;
}

export const WorkbenchConversationRunChat = iso(`
  field WorkspaceConversationRun.WorkbenchConversationRunChat @component {
    id
    workspaceId
    status
    error
    startedAt
    openResponses(first: 1) {
      edges {
        node {
          id
          status
          outputItems(first: 200) {
            edges {
              node {
                __typename
                asOutputMessage {
                  id
                  role
                  content
                }
                asOutputReasoning {
                  id
                  summary
                  reasoningType
                }
                asOutputToolCall {
                  id
                  toolCallId
                  toolName
                  status
                  argumentsText
                  resultText
                  error
                }
              }
            }
          }
        }
      }
    }
  }
`)(function WorkbenchConversationRunChat({ data }, componentProps: {
  open: boolean;
  codexAccess?: {
    model?: string;
    workspaceId?: string;
    available?: boolean;
    requiresLogin?: boolean;
    loggedIn?: boolean;
    statusText?: string;
    trustedPath?: string | null;
    writeEnabled?: boolean;
  } | null;
  testIdPrefix?: string;
  onSend: (args: {
    workspaceId: string;
    runId: string;
    message: string;
    optimisticOpenResponseId: string;
    optimisticMessageId: string;
    optimisticOutputEdges: Array<{
      node: {
        __typename: "OutputMessage";
        asOutputMessage: {
          id: string;
          role: "user" | "assistant";
          content: string;
        };
      };
    }>;
    onComplete: () => void;
    onError: () => void;
  }) => void;
  onStop: (args: {
    workspaceId: string;
    runId: string;
    optimisticOpenResponseId: string;
    optimisticOutputEdges: Array<{
      node: {
        __typename: "OutputMessage";
        asOutputMessage: {
          id: string;
          role: "user" | "assistant";
          content: string;
        };
      };
    }>;
    onComplete: () => void;
    onError: () => void;
  }) => void;
  isSending: boolean;
  isStopping: boolean;
  canStartNewChat?: boolean;
  onNewChat?: () => void;
}) {
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedCodexLoginCommand, setCopiedCodexLoginCommand] = useState(false);
  const [codexOverlayDismissed, setCodexOverlayDismissed] = useState(false);
  const testIdPrefix = (componentProps.testIdPrefix ?? "build").trim() ||
    "build";
  const chatInputTestId = `${testIdPrefix}-chat-input`;
  const startButtonTestId = `${testIdPrefix}-start`;
  const sendButtonTestId = `${testIdPrefix}-send`;
  const stopButtonTestId = `${testIdPrefix}-stop`;
  const activityIndicatorTestId = `${testIdPrefix}-chat-activity-indicator`;
  const activityTimerTestId = `${testIdPrefix}-chat-activity-timer`;
  const workspaceId = typeof data.workspaceId === "string" &&
      data.workspaceId.trim().length > 0
    ? data.workspaceId
    : null;
  const codexLoginRequired = componentProps.codexAccess
    ? (componentProps.codexAccess.requiresLogin === true ||
      componentProps.codexAccess.loggedIn !== true)
    : false;
  const showCodexLoginOverlay = codexLoginRequired && !codexOverlayDismissed;
  const codexLoginCommand = "codex login";
  const firstOpenResponse = (data.openResponses?.edges ?? []).flatMap((
    edge,
  ) => edge?.node ? [edge.node] : [])[0] ?? null;
  const startedAtMs = typeof data.startedAt === "string"
    ? Date.parse(data.startedAt)
    : Number.NaN;
  const resolvedStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : null;
  const runStatus = toRunStatus(firstOpenResponse?.status ?? data.status);
  const scenarioRunError = typeof data.error === "string" &&
      data.error.trim().length > 0
    ? data.error.trim()
    : null;
  const outputNodes = (firstOpenResponse?.outputItems?.edges ?? []).flatMap((
    edge,
  ) => edge?.node ? [edge.node] : []);
  const outputDisplay = useMemo(
    () => toOutputDisplayEntries(outputNodes),
    [outputNodes],
  );
  const messages = outputDisplay.messages;
  const optimisticOutputEdges = useMemo(
    () => toOptimisticOutputEdges(messages),
    [messages],
  );
  const transcriptDisplay = outputDisplay.display;
  useEffect(() => {
    logBuildChatDebug("drawer.state", {
      runId: data.id ?? null,
      openResponseId: firstOpenResponse?.id ?? null,
      runStatus,
      outputNodeCount: outputNodes.length,
      messageCount: messages.length,
      transcriptCount: transcriptDisplay.length,
    });
  }, [
    firstOpenResponse?.id,
    data.id,
    messages.length,
    outputNodes.length,
    runStatus,
    transcriptDisplay.length,
  ]);
  const runId = typeof data.id === "string" && data.id.trim().length > 0
    ? data.id
    : workspaceId;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const wasActiveRef = useRef(false);
  const [chatDraft, setChatDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const onSendMessage = useCallback((
    message: string,
    options?: { allowEmpty?: boolean },
  ) => {
    if (codexLoginRequired) {
      setChatError("Codex login is required for this workspace.");
      return Promise.resolve();
    }
    const trimmedMessage = message.trim();
    const allowEmpty = options?.allowEmpty === true;
    if (!workspaceId || (!allowEmpty && trimmedMessage.length === 0)) {
      setChatError("Workspace is not available for chat.");
      return Promise.resolve();
    }
    const optimisticRunId = runId ?? workspaceId;
    const optimisticOpenResponseId =
      (typeof firstOpenResponse?.id === "string" && firstOpenResponse.id) ||
      `${optimisticRunId}:open-response`;
    const optimisticMessageId = `${optimisticRunId}:message:${Date.now()}`;
    setChatError(null);
    return new Promise<void>((resolve, reject) => {
      componentProps.onSend({
        workspaceId,
        runId: optimisticRunId,
        message: trimmedMessage,
        optimisticOpenResponseId,
        optimisticMessageId,
        optimisticOutputEdges,
        onComplete: () => {
          setChatError(null);
          resolve();
        },
        onError: () => {
          const message = "GraphQL request failed";
          setChatError(message);
          reject(new Error(message));
        },
      });
    });
  }, [
    componentProps,
    codexLoginRequired,
    firstOpenResponse?.id,
    optimisticOutputEdges,
    runId,
    workspaceId,
  ]);

  const onStopRun = useCallback(() => {
    if (codexLoginRequired) {
      setChatError("Codex login is required for this workspace.");
      return Promise.resolve();
    }
    if (!workspaceId || !runId) {
      setChatError("No active run to stop.");
      return Promise.resolve();
    }
    const optimisticOpenResponseId =
      (typeof firstOpenResponse?.id === "string" && firstOpenResponse.id) ||
      `${runId}:open-response`;
    setChatError(null);
    return new Promise<void>((resolve, reject) => {
      componentProps.onStop({
        workspaceId,
        runId,
        optimisticOpenResponseId,
        optimisticOutputEdges,
        onComplete: () => {
          setChatError(null);
          resolve();
        },
        onError: () => {
          const message = "GraphQL request failed";
          setChatError(message);
          reject(new Error(message));
        },
      });
    });
  }, [
    componentProps,
    codexLoginRequired,
    firstOpenResponse?.id,
    optimisticOutputEdges,
    runId,
    workspaceId,
  ]);
  const isRunning = runStatus === "RUNNING";
  const isBusy = componentProps.isSending || componentProps.isStopping;
  const canStartAssistant = !isRunning && !componentProps.isSending &&
    messages.length === 0;
  const canSubmitMessage = !componentProps.isSending && !isRunning &&
    chatDraft.trim().length > 0;
  const showStartButton = canStartAssistant && chatDraft.trim().length === 0;
  const resolvedError = chatError ?? localError;
  const handleCopyCodexLoginCommand = useCallback(() => {
    globalThis.navigator?.clipboard?.writeText(codexLoginCommand);
    setCopiedCodexLoginCommand(true);
    globalThis.setTimeout(() => setCopiedCodexLoginCommand(false), 1200);
  }, []);
  const emptyStateText = isRunning
    ? "Run is active. Waiting for response..."
    : "No messages yet.";
  const lastNonEmptyTranscriptRef = useRef<Array<BuildDisplayMessage>>([]);
  useEffect(() => {
    if (transcriptDisplay.length > 0) {
      lastNonEmptyTranscriptRef.current = transcriptDisplay;
    }
  }, [transcriptDisplay]);
  const effectiveTranscriptDisplay = transcriptDisplay.length === 0 &&
      (isBusy || isRunning) &&
      lastNonEmptyTranscriptRef.current.length > 0
    ? lastNonEmptyTranscriptRef.current
    : transcriptDisplay;
  const activityState = deriveBuildChatActivityState({
    runStatus: toBuildChatRunStatus(runStatus),
    chatSending: componentProps.isSending,
    display: effectiveTranscriptDisplay,
    streamingAssistant: null,
    runId: runId ?? workspaceId ?? "unknown-run",
  });
  const transcriptSignature = useMemo(
    () =>
      effectiveTranscriptDisplay.map((entry, index) =>
        `${index}:${entry.kind}:${
          entry.kind === "message"
            ? `${entry.role}:${entry.content}`
            : entry.kind === "tool"
            ? (entry.toolCallId ?? entry.toolSummary?.id ?? "tool")
            : (entry.reasoningId ?? entry.content)
        }`
      ).join("\n"),
    [effectiveTranscriptDisplay],
  );

  useEffect(() => {
    const element = transcriptRef.current;
    if (!element || !shouldAutoScrollRef.current) return;
    const frame = requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [transcriptSignature]);

  useEffect(() => {
    const isActive = isRunning || isBusy;
    if (wasActiveRef.current && !isActive && componentProps.open) {
      composerInputRef.current?.focus();
    }
    wasActiveRef.current = isActive;
  }, [componentProps.open, isBusy, isRunning]);

  const sendMessage = useCallback(async () => {
    const trimmed = chatDraft.trim();
    if (!canSubmitMessage || isBusy) return;
    setLocalError(null);
    try {
      await onSendMessage(trimmed);
      setChatDraft("");
    } catch (error) {
      setLocalError(toErrorMessage(error));
    }
  }, [canSubmitMessage, chatDraft, isBusy, onSendMessage]);

  const startAssistant = useCallback(async () => {
    if (!showStartButton || isBusy) return;
    setLocalError(null);
    try {
      await onSendMessage("", { allowEmpty: true });
    } catch (error) {
      setLocalError(toErrorMessage(error));
    }
  }, [isBusy, onSendMessage, showStartButton]);

  const stopMessage = useCallback(async () => {
    if (isBusy || !isRunning) return;
    setLocalError(null);
    try {
      await onStopRun();
    } catch (error) {
      setLocalError(toErrorMessage(error));
    }
  }, [isBusy, isRunning, onStopRun]);
  const addScenarioErrorToChat = useCallback(() => {
    if (!scenarioRunError) return;
    const prefixedError = `Scenario error: ${scenarioRunError}`;
    setChatDraft((previous) => {
      if (previous.includes(prefixedError)) return previous;
      if (previous.trim().length === 0) return prefixedError;
      return `${previous}\n\n${prefixedError}`;
    });
    composerInputRef.current?.focus();
  }, [scenarioRunError]);
  const newChatButtonTestId = `${testIdPrefix}-new-chat`;
  const errorCalloutTestId = `${testIdPrefix}-error-callout`;
  const addErrorToChatTestId = `${testIdPrefix}-add-error-to-chat`;

  const chatBody = (
    <div className="test-bot-sidebar flex-column gap-8 flex-1 build-chat-panel">
      {showCodexLoginOverlay && (
        <CodexLoginRequiredOverlay
          codexWorkspaceLoggedIn={componentProps.codexAccess?.loggedIn === true
            ? true
            : false}
          codexLoginCommand={codexLoginCommand}
          copiedCodexLoginCommand={copiedCodexLoginCommand}
          showCodexLoginRecheck={false}
          codexLoginRecheckPending={false}
          codexLoginStatusText={componentProps.codexAccess?.statusText ?? null}
          codexLoginError={null}
          onCopyCodexLoginCommand={handleCopyCodexLoginCommand}
          onDismiss={() => setCodexOverlayDismissed(true)}
        />
      )}
      <div className="test-bot-thread">
        <div
          className="imessage-thread"
          ref={transcriptRef}
          onScroll={(event) => {
            shouldAutoScrollRef.current = isNearBottom(event.currentTarget);
          }}
        >
          {effectiveTranscriptDisplay.length === 0
            ? <Callout>{emptyStateText}</Callout>
            : <BuildChatRows display={effectiveTranscriptDisplay} />}
        </div>
      </div>
      <div className="composer">
        <div className="composer-inputs">
          <div className="build-chat-activity-sticky">
            <BuildChatActivityIndicator
              state={activityState}
              startedAtMs={resolvedStartedAtMs}
              testId={activityIndicatorTestId}
              timerTestId={activityTimerTestId}
            />
          </div>
          {scenarioRunError && (
            <Callout
              variant="danger"
              title="Scenario run failed"
              actions={
                <Button
                  variant="secondary"
                  size="small"
                  data-testid={addErrorToChatTestId}
                  onClick={addScenarioErrorToChat}
                >
                  Add to chat
                </Button>
              }
              data-testid={errorCalloutTestId}
            >
              {scenarioRunError}
            </Callout>
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
              onChange={(event) => setChatDraft(event.target.value)}
              data-testid={chatInputTestId}
              disabled={isBusy}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (canSubmitMessage) {
                    void sendMessage();
                  }
                }
              }}
            />
            <div className="composer-actions">
              {componentProps.onNewChat && (
                <Button
                  variant="secondary"
                  disabled={isBusy || isRunning ||
                    componentProps.canStartNewChat === false}
                  data-testid={newChatButtonTestId}
                  onClick={componentProps.onNewChat}
                >
                  New chat
                </Button>
              )}
              {isRunning && (
                <Button
                  variant="secondary"
                  disabled={isBusy}
                  data-testid={stopButtonTestId}
                  onClick={() => {
                    void stopMessage();
                  }}
                >
                  {componentProps.isStopping ? "Stopping..." : "Stop"}
                </Button>
              )}
              {showStartButton
                ? (
                  <Button
                    variant="primary"
                    disabled={!showStartButton || isBusy || codexLoginRequired}
                    data-testid={startButtonTestId}
                    onClick={() => {
                      void startAssistant();
                    }}
                  >
                    {componentProps.isSending ? "Starting..." : "Start"}
                  </Button>
                )
                : (
                  <Button
                    variant="primary"
                    disabled={!canSubmitMessage || isBusy || codexLoginRequired}
                    data-testid={sendButtonTestId}
                    onClick={() => {
                      void sendMessage();
                    }}
                  >
                    {componentProps.isSending ? "Sending..." : "Send"}
                  </Button>
                )}
            </div>
          </div>
          {resolvedError && <div className="error">{resolvedError}</div>}
        </div>
      </div>
    </div>
  );

  return (
    <WorkbenchDrawerIso
      open={componentProps.open}
      runStatus={runStatus}
      chatBody={chatBody}
    />
  );
});

export default WorkbenchConversationRunChat;
