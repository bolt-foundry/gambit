import { iso } from "@iso-gambit-sim";
import {
  type ReactNode,
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
  describeWorkbenchOutboundMessage,
  encodeWorkbenchMessageWithContext,
  formatElapsedDuration,
  synthesizeWorkbenchMessageBody,
} from "../../../src/Chat.tsx";
import Button from "../../../src/gds/Button.tsx";
import Callout from "../../../src/gds/Callout.tsx";
import CodexLoginRequiredOverlay from "../../../src/CodexLoginRequiredOverlay.tsx";
import WorkbenchChatIntro from "../../../src/WorkbenchChatIntro.tsx";
import WorkbenchComposerChip from "../../../src/gds/WorkbenchComposerChip.tsx";
import type {
  BuildChatProvider,
  BuildDisplayMessage,
} from "../../../src/utils.ts";
import {
  countTranscriptMessages,
  type OptimisticTranscriptEntry,
  type ParsedTranscriptEntry,
  parseTranscriptEntries,
  toBuildDisplayEntries,
  toOptimisticTranscriptEntries,
} from "../../../src/transcriptEntries.ts";
import WorkbenchDrawerIso, {
  type WorkbenchChatRunStatus,
} from "../../../src/WorkbenchDrawerIso.tsx";
import { workbenchChatTopActionsEnabled } from "../../../src/utils.ts";
import {
  toWorkbenchMessageContext,
  type WorkbenchSelectedContextChip,
} from "../../../src/workbenchContext.ts";
import { mergeWorkbenchSelectedContextChip } from "../../../src/workbenchChipStore.ts";

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
  let stored = "";
  try {
    stored = (globalThis.localStorage?.getItem("gambit:build-chat-debug") ?? "")
      .toLowerCase()
      .trim();
  } catch {
    return false;
  }
  return stored === "1" || stored === "true" || stored === "yes";
}

function logBuildChatDebug(
  event: string,
  payload: Record<string, unknown>,
): void {
  if (!isBuildChatDebugEnabled()) return;
  console.info(`[build-chat-debug] ${event}`, payload);
}

function toRunStatus(value: unknown): WorkbenchChatRunStatus {
  if (typeof value !== "string") return "IDLE";
  return RUN_STATUS_VALUES.has(value as WorkbenchChatRunStatus)
    ? (value as WorkbenchChatRunStatus)
    : "IDLE";
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
        }
      }
    }
    transcriptEntries {
      asWorkspaceConversationTranscriptMessage {
        id
        role
        content
        messageRefId
        feedbackEligible
      }
      asWorkspaceConversationTranscriptReasoning {
        id
        summary
        reasoningType
      }
      asWorkspaceConversationTranscriptToolCall {
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
`)(function WorkbenchConversationRunChat({ data }, componentProps: {
  open: boolean;
  buildChatProvider: BuildChatProvider;
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
    optimisticTranscriptEntries: Array<OptimisticTranscriptEntry>;
    onComplete: () => void;
    onError: () => void;
  }) => void;
  onStop: (args: {
    workspaceId: string;
    runId: string;
    optimisticOpenResponseId: string;
    optimisticTranscriptEntries: Array<OptimisticTranscriptEntry>;
    onComplete: () => void;
    onError: () => void;
  }) => void;
  isSending: boolean;
  isStopping: boolean;
  canStartNewChat?: boolean;
  onNewChat?: () => void;
  chatHeaderActions?: ReactNode;
  chatHistoryOpen?: boolean;
  onToggleChatHistory?: () => void;
  chatHistoryContent?: ReactNode;
  composerChips?: Array<WorkbenchSelectedContextChip>;
  onComposerChipsChange?: (next: Array<WorkbenchSelectedContextChip>) => void;
}) {
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedCodexLoginCommand, setCopiedCodexLoginCommand] = useState(false);
  const [codexOverlayDismissed, setCodexOverlayDismissed] = useState(false);
  const testIdPrefix = (componentProps.testIdPrefix ?? "build").trim() ||
    "build";
  const chatInputTestId = `${testIdPrefix}-chat-input`;
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
  const providerLabel = componentProps.buildChatProvider === "claude-code-cli"
    ? "Claude Code"
    : "Codex";
  const providerLoginRequired = componentProps.buildChatProvider === "codex-cli"
    ? codexLoginRequired
    : false;
  const showProviderLoginOverlay = providerLoginRequired &&
    !codexOverlayDismissed;
  const providerLoginCommand = componentProps.buildChatProvider ===
      "claude-code-cli"
    ? "claude auth login"
    : "codex login";
  const startedAtMs = typeof data.startedAt === "string"
    ? Date.parse(data.startedAt)
    : Number.NaN;
  const resolvedStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : null;
  const firstOpenResponse = (data.openResponses?.edges ?? []).flatMap((edge) =>
    edge?.node ? [edge.node] : []
  )[0] ?? null;
  const runStatus = toRunStatus(firstOpenResponse?.status ?? data.status);
  const scenarioRunError = typeof data.error === "string" &&
      data.error.trim().length > 0
    ? data.error.trim()
    : null;
  const transcriptEntries = useMemo<Array<ParsedTranscriptEntry>>(() => {
    return parseTranscriptEntries(data.transcriptEntries);
  }, [data.transcriptEntries]);
  const transcriptMessageCount = useMemo(
    () =>
      countTranscriptMessages(transcriptEntries),
    [transcriptEntries],
  );
  const optimisticTranscriptEntries = useMemo<Array<OptimisticTranscriptEntry>>(
    () => toOptimisticTranscriptEntries(transcriptEntries),
    [transcriptEntries],
  );
  const transcriptDisplay = useMemo<Array<BuildDisplayMessage>>(
    () => toBuildDisplayEntries(transcriptEntries),
    [transcriptEntries],
  );
  useEffect(() => {
    logBuildChatDebug("drawer.state", {
      runId: data.id ?? null,
      runStatus,
      messageCount: transcriptMessageCount,
      transcriptCount: transcriptDisplay.length,
    });
  }, [
    data.id,
    runStatus,
    transcriptMessageCount,
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
  const composerChips = componentProps.composerChips ?? [];
  const updateComposerChips = componentProps.onComposerChipsChange ??
    (() => {});

  const onSendMessage = useCallback((
    message: string,
    options?: { allowEmpty?: boolean },
  ) => {
    if (providerLoginRequired) {
      setChatError(`${providerLabel} login is required for this workspace.`);
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
        optimisticTranscriptEntries,
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
    firstOpenResponse?.id,
    optimisticTranscriptEntries,
    providerLabel,
    providerLoginRequired,
    runId,
    workspaceId,
  ]);

  const onStopRun = useCallback(() => {
    if (providerLoginRequired) {
      setChatError(`${providerLabel} login is required for this workspace.`);
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
        optimisticTranscriptEntries,
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
    firstOpenResponse?.id,
    optimisticTranscriptEntries,
    providerLabel,
    providerLoginRequired,
    runId,
    workspaceId,
  ]);
  const isRunning = runStatus === "RUNNING";
  const isBusy = componentProps.isSending || componentProps.isStopping;
  const hasEnabledComposerChip = composerChips.some((chip) => chip.enabled);
  const canStartAssistant = !isRunning && !componentProps.isSending &&
    transcriptMessageCount === 0;
  const canSubmitMessage = !componentProps.isSending && !isRunning &&
    (chatDraft.trim().length > 0 || hasEnabledComposerChip);
  const showStartOverlay = canStartAssistant && !hasEnabledComposerChip &&
    chatDraft.trim().length === 0;
  const resolvedError = chatError ?? localError;
  const handleCopyCodexLoginCommand = useCallback(() => {
    globalThis.navigator?.clipboard?.writeText(providerLoginCommand);
    setCopiedCodexLoginCommand(true);
    globalThis.setTimeout(() => setCopiedCodexLoginCommand(false), 1200);
  }, [providerLoginCommand]);
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
    const activeChips = composerChips.filter((chip) => chip.enabled);
    const activeChipIds = new Set(activeChips.map((chip) => chip.chipId));
    const outboundBody = trimmed ||
      synthesizeWorkbenchMessageBody(
        activeChips.map((chip) => toWorkbenchMessageContext(chip)),
      );
    const outboundMessage = activeChips.length > 0
      ? encodeWorkbenchMessageWithContext(
        outboundBody,
        activeChips.map((chip) => toWorkbenchMessageContext(chip)),
      )
      : outboundBody;
    const outboundDebug = describeWorkbenchOutboundMessage(outboundMessage);
    logBuildChatDebug("send.outbound", {
      runId,
      workspaceId,
      trimmed,
      activeChips,
      ...outboundDebug,
    });
    setLocalError(null);
    try {
      await onSendMessage(outboundMessage);
      setChatDraft("");
      if (activeChipIds.size > 0) {
        updateComposerChips(
          composerChips.map((chip) =>
            activeChipIds.has(chip.chipId) ? { ...chip, enabled: false } : chip
          ),
        );
      }
    } catch (error) {
      setLocalError(toErrorMessage(error));
    }
  }, [
    canSubmitMessage,
    chatDraft,
    composerChips,
    isBusy,
    onSendMessage,
    updateComposerChips,
  ]);

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
    updateComposerChips(
      mergeWorkbenchSelectedContextChip(composerChips, {
        chipId: `scenario_run_error:${runId ?? workspaceId ?? "workspace"}`,
        source: "scenario_run_error",
        workspaceId: workspaceId ?? undefined,
        runId: runId ?? undefined,
        capturedAt: new Date().toISOString(),
        error: scenarioRunError,
        enabled: true,
      }),
    );
    composerInputRef.current?.focus();
  }, [
    composerChips,
    runId,
    scenarioRunError,
    updateComposerChips,
    workspaceId,
  ]);
  const errorCalloutTestId = `${testIdPrefix}-error-callout`;
  const addErrorToChatTestId = `${testIdPrefix}-add-error-to-chat`;

  const chatBody = (
    <div className="test-bot-sidebar flex-column gap-8 flex-1 build-chat-panel">
      {showProviderLoginOverlay && (
        <CodexLoginRequiredOverlay
          providerLabel={providerLabel}
          providerWorkspaceLoggedIn={componentProps.codexAccess?.loggedIn ===
              true
            ? true
            : false}
          loginCommand={providerLoginCommand}
          copiedLoginCommand={copiedCodexLoginCommand}
          showLoginRecheck={false}
          loginRecheckPending={false}
          loginStatusText={componentProps.codexAccess?.statusText ?? null}
          loginError={null}
          onCopyLoginCommand={handleCopyCodexLoginCommand}
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
          {!showProviderLoginOverlay && showStartOverlay &&
            <WorkbenchChatIntro />}
          {effectiveTranscriptDisplay.length === 0
            ? (
              showStartOverlay && !showProviderLoginOverlay
                ? null
                : <Callout>{emptyStateText}</Callout>
            )
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
          {composerChips.length > 0 && (
            <div
              className="workbench-composer-chip-row"
              data-testid={`${testIdPrefix}-composer-chip-row`}
            >
              {composerChips.map((chip) => (
                <WorkbenchComposerChip
                  key={chip.chipId}
                  context={chip}
                  enabled={chip.enabled}
                  onEnabledChange={(enabled) =>
                    updateComposerChips(
                      composerChips.map((entry) =>
                        entry.chipId === chip.chipId
                          ? { ...entry, enabled }
                          : entry
                      ),
                    )}
                  onRemove={() =>
                    updateComposerChips(
                      composerChips.filter((entry) =>
                        entry.chipId !== chip.chipId
                      ),
                    )}
                />
              ))}
            </div>
          )}
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
          <div className="flex-row gap-4 mb-2">
            <textarea
              ref={composerInputRef}
              className="message-input flex-1"
              rows={1}
              placeholder="Message Gambit Bot..."
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
              <div className="composer-action-slot composer-action-slot-primary">
                {isRunning
                  ? (
                    <Button
                      variant="secondary"
                      className="composer-action-button"
                      disabled={isBusy}
                      data-testid={stopButtonTestId}
                      onClick={() => {
                        void stopMessage();
                      }}
                    >
                      {componentProps.isStopping ? "Stopping..." : "Stop"}
                    </Button>
                  )
                  : (
                    <Button
                      variant="primary"
                      className="composer-action-button"
                      disabled={!canSubmitMessage || isBusy ||
                        codexLoginRequired}
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
      chatHeaderActions={componentProps.chatHeaderActions}
      chatHistoryOpen={workbenchChatTopActionsEnabled
        ? componentProps.chatHistoryOpen
        : false}
      chatHistoryContent={componentProps.chatHistoryContent}
      chatBody={chatBody}
    />
  );
});

export default WorkbenchConversationRunChat;
