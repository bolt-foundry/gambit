import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { WORKSPACES_API_BASE } from "../../src/workspace_contract.ts";
import Button from "./gds/Button.tsx";
import Badge from "./gds/Badge.tsx";
import Icon from "./gds/Icon.tsx";
import ScrollingText from "./gds/ScrollingText.tsx";
import Callout from "./gds/Callout.tsx";
import Chat from "./Chat.tsx";
import Accordion from "./gds/Accordion.tsx";
import Listbox, { type ListboxOption } from "./gds/Listbox.tsx";
import CodexLoginRequiredOverlay from "./CodexLoginRequiredOverlay.tsx";
import { useBuildChat } from "./BuildChatContext.tsx";
import List from "./gds/List.tsx";
import ListItem from "./gds/ListItem.tsx";
import ProviderLoginPanel from "./ProviderLoginPanel.tsx";
import {
  type BuildChatProvider,
  chatAccordionEnabled,
  extractGradingFlags,
  extractScoreAndReason,
  extractTurnContext,
  formatSnippet,
  formatTimestampShort,
  getScoreClass,
} from "./utils.ts";
import type {
  FeedbackEntry,
  GradingFlag,
  SessionDetailResponse,
} from "./utils.ts";
import type { WorkbenchComposerChip } from "./Chat.tsx";

type WorkbenchDrawerFeedbackItem = {
  entry: FeedbackEntry;
  message?: { content?: string } | null;
  role?: string | null;
};

type WorkbenchDrawerRunItem = {
  turnNumber?: number;
  input?: unknown;
  result?: unknown;
};

type WorkbenchDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  statePath?: string | null;
  loading?: boolean;
  error?: string | null;
  sessionId?: string | null;
  messages?: Array<{
    content?: string;
    role?: string;
    messageRefId?: string;
    feedback?: FeedbackEntry | null;
  }>;
  sessionDetail?: SessionDetailResponse | null;
  feedbackItems?: Array<WorkbenchDrawerFeedbackItem>;
  gradingFlags?: Array<GradingFlag>;
  runLabelById?: Map<string, string>;
  runItemByRefId?: Map<string, WorkbenchDrawerRunItem>;
  composerChips?: Array<WorkbenchComposerChip>;
  onComposerChipsChange?: (next: Array<WorkbenchComposerChip>) => void;
};

type CodexOverlayState = {
  copiedCodexLoginCommand: boolean;
  codexLoginRecheckPending: boolean;
  showCodexLoginRecheck: boolean;
  codexAutoRecheckActive: boolean;
  codexWorkspaceLoggedIn: boolean | null;
  codexLoginError: string | null;
  codexLoginStatusText: string | null;
  codexLoginOverlayDismissed: boolean;
};

type CodexOverlayAction =
  | { type: "reset_for_session" }
  | { type: "status_fetch_start" }
  | {
    type: "status_fetch_success";
    loggedIn: boolean;
    statusText: string | null;
  }
  | { type: "status_fetch_error"; error: string }
  | { type: "copy_login_command" }
  | { type: "clear_copied_login_command" }
  | { type: "start_recheck" }
  | { type: "finish_recheck" }
  | { type: "show_recheck" }
  | { type: "dismiss_overlay" };

const initialCodexOverlayState: CodexOverlayState = {
  copiedCodexLoginCommand: false,
  codexLoginRecheckPending: false,
  showCodexLoginRecheck: false,
  codexAutoRecheckActive: false,
  codexWorkspaceLoggedIn: null,
  codexLoginError: null,
  codexLoginStatusText: null,
  codexLoginOverlayDismissed: false,
};

function codexOverlayReducer(
  state: CodexOverlayState,
  action: CodexOverlayAction,
): CodexOverlayState {
  switch (action.type) {
    case "reset_for_session":
      return initialCodexOverlayState;
    case "status_fetch_start":
      return {
        ...state,
        codexLoginError: null,
      };
    case "status_fetch_success":
      return {
        ...state,
        codexWorkspaceLoggedIn: action.loggedIn,
        codexLoginStatusText: action.statusText,
        showCodexLoginRecheck: action.loggedIn
          ? false
          : state.showCodexLoginRecheck,
        codexAutoRecheckActive: action.loggedIn
          ? false
          : state.codexAutoRecheckActive,
      };
    case "status_fetch_error":
      return {
        ...state,
        codexWorkspaceLoggedIn: null,
        codexLoginStatusText: null,
        codexLoginError: action.error,
      };
    case "copy_login_command":
      return {
        ...state,
        copiedCodexLoginCommand: true,
        showCodexLoginRecheck: true,
        codexAutoRecheckActive: true,
      };
    case "clear_copied_login_command":
      return {
        ...state,
        copiedCodexLoginCommand: false,
      };
    case "start_recheck":
      return {
        ...state,
        codexLoginRecheckPending: true,
        codexLoginError: null,
      };
    case "finish_recheck":
      return {
        ...state,
        codexLoginRecheckPending: false,
      };
    case "show_recheck":
      return {
        ...state,
        showCodexLoginRecheck: true,
      };
    case "dismiss_overlay":
      return {
        ...state,
        codexLoginOverlayDismissed: true,
        codexAutoRecheckActive: false,
      };
    default:
      return state;
  }
}

export default function WorkbenchDrawer(props: WorkbenchDrawerProps) {
  const {
    run,
    chatSending,
    resetChat,
    loadChat,
    buildChatProvider,
    setBuildChatProvider,
  } = useBuildChat();
  const {
    open = true,
    onClose,
    statePath,
    loading = false,
    error = null,
    sessionId,
    messages,
    sessionDetail,
    feedbackItems,
    gradingFlags,
    runLabelById = new Map(),
    runItemByRefId = new Map(),
    composerChips = [],
    onComposerChipsChange,
  } = props;
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    Array<{
      id: string;
      updatedAt?: string;
      startedAt?: string;
    }>
  >([]);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [chatHistoryError, setChatHistoryError] = useState<string | null>(null);
  const [copiedStatePath, setCopiedStatePath] = useState(false);
  const [codexOverlayState, dispatchCodexOverlay] = useReducer(
    codexOverlayReducer,
    initialCodexOverlayState,
  );
  const {
    copiedCodexLoginCommand,
    codexLoginRecheckPending,
    showCodexLoginRecheck,
    codexAutoRecheckActive,
    codexWorkspaceLoggedIn,
    codexLoginError,
    codexLoginStatusText,
    codexLoginOverlayDismissed,
  } = codexOverlayState;
  const initializedChipTrackingRef = useRef(false);
  const seenRatingChipIdsRef = useRef(new Set<string>());
  const seenFlagChipIdsRef = useRef(new Set<string>());
  const buildProviderOptions = useMemo<Array<ListboxOption>>(
    () => [
      { value: "codex-cli", label: "Codex" },
      { value: "claude-code-cli", label: "Claude Code" },
    ],
    [],
  );
  const codexLoginCommand = "codex login";
  const codexWorkspaceId = sessionId ?? run.id;
  const codexStatusEndpoint = codexWorkspaceId
    ? `/api/codex/trust-workspace?workspaceId=${
      encodeURIComponent(codexWorkspaceId)
    }`
    : "/api/codex/trust-workspace";
  const showCodexLoginOverlay = (codexWorkspaceLoggedIn === false &&
    !codexLoginOverlayDismissed) || Boolean(codexLoginError);
  const resolvedStatePath = useMemo(() => {
    if (statePath) return statePath;
    const meta = sessionDetail?.meta;
    if (meta && typeof meta === "object") {
      const sessionStatePath = (meta as { sessionStatePath?: unknown })
        .sessionStatePath;
      if (typeof sessionStatePath === "string") {
        return sessionStatePath;
      }
    }
    return null;
  }, [sessionDetail?.meta, statePath]);
  const resolvedFeedbackItems = useMemo(() => {
    if (sessionDetail) {
      const feedback = sessionDetail.feedback ?? [];
      const refs = sessionDetail.messageRefs ?? [];
      const messages = sessionDetail.messages ?? [];
      const messageByRefId = new Map<
        string,
        { content?: string; role?: string }
      >();
      const roleByRefId = new Map<string, string>();
      refs.forEach((ref, index) => {
        if (!ref?.id) return;
        const message = messages[index];
        if (message) {
          messageByRefId.set(
            ref.id,
            message as { content?: string; role?: string },
          );
        }
        if (ref.role) roleByRefId.set(ref.id, ref.role);
      });
      const items = feedback.map((entry) => {
        const message = messageByRefId.get(entry.messageRefId);
        const role = message?.role ?? roleByRefId.get(entry.messageRefId);
        return { entry, message, role };
      });
      return items.sort((a, b) => {
        const aKey = a.entry.createdAt ?? "";
        const bKey = b.entry.createdAt ?? "";
        return bKey.localeCompare(aKey);
      });
    }
    if (feedbackItems !== undefined) return feedbackItems;
    if (!messages?.length) return [];
    const items: Array<
      WorkbenchDrawerFeedbackItem & { _sortIndex?: number }
    > = [];
    messages.forEach((message, index) => {
      if (!message?.feedback) return;
      items.push({
        entry: message.feedback,
        message: { content: message.content },
        role: message.role,
        _sortIndex: index,
      });
    });
    return items.sort((a, b) => {
      const aKey = a.entry.createdAt ?? "";
      const bKey = b.entry.createdAt ?? "";
      if (aKey && bKey && aKey !== bKey) {
        return bKey.localeCompare(aKey);
      }
      return (b._sortIndex ?? 0) - (a._sortIndex ?? 0);
    });
  }, [feedbackItems, messages, sessionDetail]);
  const resolvedGradingFlags = useMemo(() => {
    if (sessionDetail) {
      return extractGradingFlags(sessionDetail.meta);
    }
    return gradingFlags ?? [];
  }, [gradingFlags, sessionDetail]);
  const resolvedRunLabelById = useMemo(() => {
    if (runLabelById.size > 0) return runLabelById;
    const meta = sessionDetail?.meta;
    const runs = meta && typeof meta === "object"
      ? (meta as { gradingRuns?: unknown }).gradingRuns
      : undefined;
    if (!Array.isArray(runs)) return runLabelById;
    const map = new Map<string, string>();
    runs.forEach((run) => {
      if (!run || typeof run !== "object") return;
      const record = run as {
        id?: unknown;
        graderLabel?: unknown;
        graderId?: unknown;
      };
      if (typeof record.id !== "string") return;
      const label = typeof record.graderLabel === "string"
        ? record.graderLabel
        : typeof record.graderId === "string"
        ? record.graderId
        : record.id;
      map.set(record.id, label);
    });
    return map;
  }, [runLabelById, sessionDetail]);
  const resolvedRunItemByRefId = useMemo(() => {
    if (runItemByRefId.size > 0) return runItemByRefId;
    const meta = sessionDetail?.meta;
    const runs = meta && typeof meta === "object"
      ? (meta as { gradingRuns?: unknown }).gradingRuns
      : undefined;
    if (!Array.isArray(runs)) return runItemByRefId;
    const map = new Map<string, WorkbenchDrawerRunItem>();
    runs.forEach((run) => {
      if (!run || typeof run !== "object") return;
      const record = run as {
        id?: unknown;
        result?: unknown;
        input?: unknown;
      };
      if (typeof record.id !== "string") return;
      const result = record.result;
      if (
        result &&
        typeof result === "object" &&
        (result as { mode?: unknown }).mode === "turns" &&
        Array.isArray((result as { turns?: unknown }).turns)
      ) {
        const turns = (result as { turns?: unknown })
          .turns as Array<{ index?: number; input?: unknown }>;
        turns.forEach((turn, idx) => {
          const index = typeof turn.index === "number" ? turn.index : idx;
          map.set(`gradingRun:${record.id}#turn:${index}`, {
            turnNumber: index + 1,
            input: turn.input,
            result: (turn as { result?: unknown }).result,
          });
        });
      } else {
        map.set(`gradingRun:${record.id}`, {
          input: record.input,
          result: record.result,
        });
      }
    });
    return map;
  }, [runItemByRefId, sessionDetail]);
  const mergeComposerChip = useCallback(
    (base: Array<WorkbenchComposerChip>, chip: WorkbenchComposerChip) => {
      const next = [...base];
      const existingIndex = next.findIndex((entry) =>
        entry.chipId === chip.chipId
      );
      if (existingIndex >= 0) {
        next[existingIndex] = {
          ...next[existingIndex],
          ...chip,
          enabled: true,
        };
        return next;
      }
      next.push(chip);
      return next;
    },
    [],
  );
  const addComposerChip = useCallback((chip: WorkbenchComposerChip) => {
    if (!onComposerChipsChange) return;
    onComposerChipsChange(mergeComposerChip(composerChips, chip));
  }, [composerChips, mergeComposerChip, onComposerChipsChange]);
  const removeComposerChip = useCallback((chipId: string) => {
    if (!onComposerChipsChange) return;
    onComposerChipsChange(
      composerChips.filter((chip) => chip.chipId !== chipId),
    );
  }, [composerChips, onComposerChipsChange]);
  const composerChipIds = useMemo(
    () => new Set(composerChips.map((chip) => chip.chipId)),
    [composerChips],
  );

  const buildRatingChip = useCallback(
    (entry: FeedbackEntry): WorkbenchComposerChip => {
      const capturedAt = entry.createdAt ?? new Date().toISOString();
      return {
        chipId: `rating:${entry.messageRefId}:${entry.id}`,
        source: "message_rating",
        workspaceId: sessionId ?? undefined,
        runId: entry.runId,
        capturedAt,
        messageRefId: entry.messageRefId,
        statePath: resolvedStatePath ?? undefined,
        statePointer: `messageRef:${entry.messageRefId}`,
        score: entry.score,
        reason: entry.reason,
        enabled: true,
      };
    },
    [resolvedStatePath, sessionId],
  );

  const resolveFlagMessage = useCallback((flag: GradingFlag): string => {
    if (flag.reason?.trim()) return flag.reason;
    const flaggedItem = resolvedRunItemByRefId.get(flag.refId);
    const gradedAssistant =
      extractTurnContext(flaggedItem?.input).gradedAssistant;
    if (gradedAssistant?.trim()) return formatSnippet(gradedAssistant);
    return "Flagged by grader";
  }, [resolvedRunItemByRefId]);

  const buildFlagChip = useCallback(
    (flag: GradingFlag): WorkbenchComposerChip => {
      const capturedAt = flag.createdAt ?? new Date().toISOString();
      return {
        // Use refId so optimistic and persisted updates collapse to one chip.
        chipId: `flag:${flag.refId}`,
        source: "grading_flag",
        workspaceId: sessionId ?? undefined,
        runId: flag.runId,
        capturedAt,
        flagId: flag.id,
        refId: flag.refId,
        score:
          extractScoreAndReason(resolvedRunItemByRefId.get(flag.refId)?.result)
            .score,
        message: resolveFlagMessage(flag),
        enabled: true,
      };
    },
    [resolveFlagMessage, resolvedRunItemByRefId, sessionId],
  );

  useEffect(() => {
    initializedChipTrackingRef.current = false;
    seenRatingChipIdsRef.current.clear();
    seenFlagChipIdsRef.current.clear();
    dispatchCodexOverlay({ type: "reset_for_session" });
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    dispatchCodexOverlay({ type: "status_fetch_start" });
    fetch(codexStatusEndpoint)
      .then(async (response) => {
        const payload = await response.json() as {
          ok?: boolean;
          trusted?: boolean;
          writeEnabled?: boolean;
          codexLoggedIn?: boolean;
          codexLoginStatus?: string;
          error?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || response.statusText);
        }
        if (canceled) return;
        dispatchCodexOverlay({
          type: "status_fetch_success",
          loggedIn: payload.codexLoggedIn === true,
          statusText: typeof payload.codexLoginStatus === "string"
            ? payload.codexLoginStatus
            : null,
        });
      })
      .catch((err) => {
        if (canceled) return;
        dispatchCodexOverlay({
          type: "status_fetch_error",
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        if (canceled) return;
      });
    return () => {
      canceled = true;
    };
  }, [codexStatusEndpoint, open]);

  useEffect(() => {
    if (!showCodexLoginOverlay) return;
    if (codexWorkspaceLoggedIn !== false) return;
    if (showCodexLoginRecheck) return;
    const timeout = globalThis.setTimeout(() => {
      dispatchCodexOverlay({ type: "show_recheck" });
    }, 5000);
    return () => globalThis.clearTimeout(timeout);
  }, [codexWorkspaceLoggedIn, showCodexLoginOverlay, showCodexLoginRecheck]);
  useEffect(() => {
    if (loading) return;
    const currentRatingChipIds = new Set(
      resolvedFeedbackItems.map(({ entry }) =>
        `rating:${entry.messageRefId}:${entry.id}`
      ),
    );
    const currentFlagChipIds = new Set(
      resolvedGradingFlags.map((flag) => `flag:${flag.refId}`),
    );
    if (!initializedChipTrackingRef.current) {
      seenRatingChipIdsRef.current = currentRatingChipIds;
      seenFlagChipIdsRef.current = currentFlagChipIds;
      initializedChipTrackingRef.current = true;
      return;
    }
    const newRatingEntries = resolvedFeedbackItems.filter(({ entry }) =>
      !seenRatingChipIdsRef.current.has(
        `rating:${entry.messageRefId}:${entry.id}`,
      )
    );
    const newFlagEntries = resolvedGradingFlags.filter((flag) =>
      !seenFlagChipIdsRef.current.has(`flag:${flag.refId}`)
    );
    if (
      (newRatingEntries.length > 0 || newFlagEntries.length > 0) &&
      onComposerChipsChange
    ) {
      let nextChips = [...composerChips];
      newRatingEntries.forEach(({ entry }) => {
        nextChips = mergeComposerChip(nextChips, buildRatingChip(entry));
      });
      newFlagEntries.forEach((flag) => {
        nextChips = mergeComposerChip(nextChips, buildFlagChip(flag));
      });
      onComposerChipsChange(nextChips);
    }

    if (onComposerChipsChange) {
      const ratingByChipId = new Map<string, WorkbenchComposerChip>(
        resolvedFeedbackItems.map(({ entry }) =>
          [
            `rating:${entry.messageRefId}:${entry.id}`,
            buildRatingChip(entry),
          ] as const
        ),
      );
      const flagByChipId = new Map<string, WorkbenchComposerChip>(
        resolvedGradingFlags.map((flag) =>
          [
            `flag:${flag.refId}`,
            buildFlagChip(flag),
          ] as const
        ),
      );
      let didChange = false;
      const syncedChips = composerChips.filter((chip) => {
        if (chip.source === "message_rating") {
          if (!chip.chipId.startsWith("rating:")) return true;
          const stillExists = ratingByChipId.has(chip.chipId);
          if (!stillExists) didChange = true;
          return stillExists;
        }
        if (chip.source === "grading_flag") {
          if (!chip.chipId.startsWith("flag:")) return true;
          const stillExists = flagByChipId.has(chip.chipId);
          if (!stillExists) didChange = true;
          return stillExists;
        }
        return true;
      }).map((chip) => {
        const latest = chip.source === "message_rating" &&
            chip.chipId.startsWith("rating:")
          ? ratingByChipId.get(chip.chipId)
          : chip.source === "grading_flag" && chip.chipId.startsWith("flag:")
          ? flagByChipId.get(chip.chipId)
          : undefined;
        if (!latest) return chip;
        const next = { ...chip, ...latest, enabled: chip.enabled };
        const changed = JSON.stringify(next) !== JSON.stringify(chip);
        if (changed) didChange = true;
        return next;
      });
      if (didChange) {
        onComposerChipsChange(syncedChips);
      }
    }

    seenRatingChipIdsRef.current = currentRatingChipIds;
    seenFlagChipIdsRef.current = currentFlagChipIds;
  }, [
    buildFlagChip,
    buildRatingChip,
    composerChips,
    loading,
    mergeComposerChip,
    onComposerChipsChange,
    resolvedFeedbackItems,
    resolvedGradingFlags,
  ]);

  const loadChatHistory = useCallback(async () => {
    if (!chatAccordionEnabled) return;
    setChatHistoryLoading(true);
    setChatHistoryError(null);
    try {
      const res = await fetch(WORKSPACES_API_BASE);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as {
        workspaces?: Array<{ id?: string; createdAt?: string }>;
      };
      const runs = Array.isArray(data.workspaces)
        ? data.workspaces.filter((entry) => typeof entry?.id === "string").map(
          (entry) => ({
            id: entry.id as string,
            updatedAt: entry.createdAt,
            startedAt: entry.createdAt,
          }),
        )
        : [];
      setChatHistory(runs);
    } catch (err) {
      setChatHistoryError(
        err instanceof Error ? err.message : "Failed to load chat history",
      );
    } finally {
      setChatHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!chatAccordionEnabled) return;
    loadChatHistory().catch(() => {});
  }, [loadChatHistory, open]);
  const runStatusLabel = run.status === "running"
    ? "Running…"
    : run.status === "completed"
    ? "Completed"
    : run.status === "error"
    ? "Failed"
    : run.status === "canceled"
    ? "Stopped"
    : "Idle";
  const showCopyStatePath = Boolean(resolvedStatePath);
  const handleCopyStatePath = useMemo(() => {
    if (!resolvedStatePath) return null;
    return () => {
      navigator.clipboard?.writeText(resolvedStatePath);
      setCopiedStatePath(true);
      globalThis.setTimeout(() => setCopiedStatePath(false), 1200);
    };
  }, [resolvedStatePath]);
  const handleCopyCodexLoginCommand = useCallback(() => {
    navigator.clipboard?.writeText(codexLoginCommand);
    dispatchCodexOverlay({ type: "copy_login_command" });
    globalThis.setTimeout(() => {
      dispatchCodexOverlay({ type: "clear_copied_login_command" });
    }, 1200);
  }, [codexLoginCommand]);
  const handleRecheckCodexLogin = useCallback(async () => {
    dispatchCodexOverlay({ type: "start_recheck" });
    try {
      const response = await fetch(codexStatusEndpoint);
      const payload = await response.json() as {
        ok?: boolean;
        codexLoggedIn?: boolean;
        codexLoginStatus?: string;
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || response.statusText);
      }
      dispatchCodexOverlay({
        type: "status_fetch_success",
        loggedIn: payload.codexLoggedIn === true,
        statusText: typeof payload.codexLoginStatus === "string"
          ? payload.codexLoginStatus
          : null,
      });
    } catch (err) {
      dispatchCodexOverlay({
        type: "status_fetch_error",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      dispatchCodexOverlay({ type: "finish_recheck" });
    }
  }, [codexStatusEndpoint]);
  useEffect(() => {
    if (!codexAutoRecheckActive) return;
    if (!showCodexLoginOverlay) return;
    if (codexWorkspaceLoggedIn !== false) return;
    const interval = globalThis.setInterval(() => {
      if (codexLoginRecheckPending) return;
      void handleRecheckCodexLogin();
    }, 2000);
    return () => globalThis.clearInterval(interval);
  }, [
    codexAutoRecheckActive,
    codexLoginRecheckPending,
    codexWorkspaceLoggedIn,
    handleRecheckCodexLogin,
    showCodexLoginOverlay,
  ]);
  useEffect(() => {
    if (!open) return;
    if (!onClose) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <aside className="workbench-drawer-docked" role="dialog">
      <Accordion
        allowMultiple
        className="workbench-accordion equal-open"
        items={[
          ...(chatAccordionEnabled
            ? [{
              id: "workbench-chat",
              title: (
                <div className="workbench-accordion-title">
                  {chatHistory.length > 0 && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="workbench-chat-history-toggle"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setChatHistoryOpen((prev) => !prev);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        setChatHistoryOpen((prev) => !prev);
                      }}
                      aria-label={chatHistoryOpen
                        ? "Hide chat history"
                        : "Show chat history"}
                    >
                      <Icon
                        name="chevronDown"
                        size={12}
                        className="workbench-chat-history-arrow"
                      />
                    </span>
                  )}
                  <span>Chat</span>
                  <Badge status={run.status}>{runStatusLabel}</Badge>
                </div>
              ),
              defaultOpen: true,
              contentClassName: "workbench-chat-content",
              headerActions: (
                <div className="workbench-chat-header-actions gds-accordion-open-only">
                  <label className="workbench-provider-select-label">
                    <div
                      className="workbench-provider-select"
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Listbox
                        value={buildChatProvider}
                        onChange={(value) =>
                          setBuildChatProvider(value as BuildChatProvider)}
                        options={buildProviderOptions}
                        disabled={chatSending || run.status === "running"}
                        size="small"
                        popoverMatchTriggerWidth={false}
                        popoverMinWidth={200}
                        popoverAlign="right"
                      />
                    </div>
                  </label>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      resetChat().then(() => {
                        loadChatHistory().catch(() => {});
                      });
                    }}
                    disabled={chatSending || run.status === "running"}
                  >
                    New chat
                  </Button>
                </div>
              ),
              content: (
                <div className="workbench-chat-panel">
                  <div className="workbench-chat-overlay">
                    <div className="workbench-chat-history">
                      {chatHistoryLoading && (
                        <Callout>
                          Loading chat history…
                        </Callout>
                      )}
                      {chatHistoryError && (
                        <div className="error">{chatHistoryError}</div>
                      )}
                      {!chatHistoryLoading &&
                        !chatHistoryError &&
                        chatHistory.length === 0 && (
                        <Callout>
                          No previous chats yet.
                        </Callout>
                      )}
                      {!chatHistoryLoading &&
                        !chatHistoryError &&
                        chatHistory.length > 0 && (
                        <List className="workbench-chat-history-list">
                          {chatHistory.map((entry) => {
                            const timestamp = entry.updatedAt ??
                              entry.startedAt;
                            const label = timestamp
                              ? formatTimestampShort(timestamp)
                              : "Unknown date";
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                className="workbench-chat-history-row gds-list-item-button"
                                onClick={() => {
                                  setChatHistoryOpen(false);
                                  loadChat(entry.id).catch(() => {});
                                }}
                              >
                                <ListItem title={`Chat - ${label}`} />
                              </button>
                            );
                          })}
                        </List>
                      )}
                    </div>
                    <div
                      className={`workbench-chat-current${
                        chatHistoryOpen ? " is-history" : ""
                      }`}
                    >
                      <ProviderLoginPanel
                        key={`${
                          sessionId ?? "sessionless"
                        }:${buildChatProvider}`}
                        open={open}
                        buildChatProvider={buildChatProvider}
                        workspaceId={(sessionId ?? run.id) || undefined}
                      />
                      {showCodexLoginOverlay && (
                        <CodexLoginRequiredOverlay
                          codexWorkspaceLoggedIn={codexWorkspaceLoggedIn}
                          codexLoginCommand={codexLoginCommand}
                          copiedCodexLoginCommand={copiedCodexLoginCommand}
                          showCodexLoginRecheck={showCodexLoginRecheck}
                          codexLoginRecheckPending={codexLoginRecheckPending}
                          codexLoginStatusText={codexLoginStatusText}
                          codexLoginError={codexLoginError}
                          onCopyCodexLoginCommand={handleCopyCodexLoginCommand}
                          onRecheckCodexLogin={() => {
                            void handleRecheckCodexLogin();
                          }}
                          onDismiss={() => {
                            dispatchCodexOverlay({ type: "dismiss_overlay" });
                          }}
                        />
                      )}
                      <Chat
                        composerChips={composerChips}
                        onComposerChipsChange={onComposerChipsChange}
                      />
                    </div>
                  </div>
                </div>
              ),
            }]
            : []),
          {
            id: "workbench-ratings",
            title: "Ratings & flags",
            defaultOpen: false,
            content: (
              <div className="workbench-ratings">
                {showCopyStatePath && handleCopyStatePath && (
                  <>
                    <Button variant="secondary" onClick={handleCopyStatePath}>
                      <Icon
                        name={copiedStatePath ? "copied" : "copy"}
                        size={14}
                      />
                      {copiedStatePath ? "Copied" : "Copy state path"}
                    </Button>
                    <p className="workbench-button-meta">
                      Paste this in your coding assistant to debug the agent.
                    </p>
                  </>
                )}
                {loading && <Callout>Loading ratings and flags…</Callout>}
                {error && <div className="error">{error}</div>}
                {!loading &&
                  !error &&
                  resolvedFeedbackItems.length === 0 &&
                  resolvedGradingFlags.length === 0 && (
                  <Callout>
                    No ratings or flags yet.
                  </Callout>
                )}
                {resolvedFeedbackItems.length > 0 && (
                  <div className="workbench-summary-list">
                    {resolvedFeedbackItems.map(({ entry, message, role }) => {
                      const ratingChip = buildRatingChip(entry);
                      const inChat = composerChipIds.has(ratingChip.chipId);
                      const roleLabel = role === "assistant"
                        ? "Assistant message"
                        : "Scenario message";
                      const displayScore = entry.score;
                      const scoreLabel = displayScore > 0
                        ? `+${displayScore}`
                        : displayScore;
                      const scoreClass = getScoreClass(displayScore);
                      return (
                        <div
                          key={`${entry.id}-${entry.messageRefId}`}
                          className="workbench-summary-card"
                        >
                          <div
                            className="workbench-summary-title"
                            title={entry.createdAt &&
                              formatTimestampShort(entry.createdAt)}
                          >
                            {roleLabel}
                          </div>
                          <div className="workbench-summary-score-row">
                            <div
                              className={`workbench-score-badge workbench-score-badge--small ${scoreClass}`}
                            >
                              {scoreLabel}
                            </div>
                            {entry.reason && (
                              <ScrollingText
                                as="div"
                                text={entry.reason}
                                className="workbench-summary-reason"
                              />
                            )}
                          </div>
                          {message?.content && (
                            <ScrollingText
                              as="div"
                              text={formatSnippet(message.content)}
                              className="workbench-summary-meta"
                            />
                          )}
                          <div className="workbench-summary-actions">
                            <Button
                              variant="secondary"
                              size="small"
                              onClick={() =>
                                inChat
                                  ? removeComposerChip(ratingChip.chipId)
                                  : addComposerChip(ratingChip)}
                              disabled={!onComposerChipsChange}
                            >
                              {inChat ? "Remove from chat" : "Add to chat"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {resolvedGradingFlags.length > 0 && (
                  <div className="workbench-summary-list">
                    {resolvedGradingFlags.map((flag) => {
                      const flagChip = buildFlagChip(flag);
                      const inChat = composerChipIds.has(flagChip.chipId);
                      const runLabel = flag.runId
                        ? resolvedRunLabelById.get(flag.runId)
                        : undefined;
                      const flaggedItem = resolvedRunItemByRefId.get(
                        flag.refId,
                      );
                      const turnLabel = flaggedItem?.turnNumber
                        ? `Assistant turn ${flaggedItem.turnNumber}`
                        : undefined;
                      const gradedAssistant = extractTurnContext(
                        flaggedItem?.input,
                      ).gradedAssistant;
                      return (
                        <div
                          key={flag.id}
                          className="workbench-summary-card workbench-flag-card"
                        >
                          <div className="workbench-summary-title">
                            Grader flag
                          </div>
                          {(runLabel || turnLabel)
                            ? (
                              <div
                                className="workbench-summary-subtitle"
                                title={flag.createdAt &&
                                  formatTimestampShort(flag.createdAt)}
                              >
                                {runLabel}
                                {runLabel && turnLabel && " • "}
                                {turnLabel}
                              </div>
                            )
                            : "Flagged grader"}
                          <div className="workbench-summary-score-row">
                            <div className="workbench-score-badge workbench-score-badge--small">
                              <Icon name="flag" size={10} />
                            </div>
                            {flag.reason && (
                              <ScrollingText
                                as="div"
                                text={flag.reason}
                                className="workbench-summary-reason"
                              />
                            )}
                          </div>
                          {gradedAssistant && (
                            <ScrollingText
                              as="div"
                              text={formatSnippet(gradedAssistant)}
                              className="workbench-summary-meta"
                            />
                          )}
                          <div className="workbench-summary-actions">
                            <Button
                              variant="secondary"
                              size="small"
                              onClick={() =>
                                inChat
                                  ? removeComposerChip(flagChip.chipId)
                                  : addComposerChip(flagChip)}
                              disabled={!onComposerChipsChange}
                            >
                              {inChat ? "Remove from chat" : "Add to chat"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </aside>
  );
}
