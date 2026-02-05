import React, { useCallback, useEffect, useMemo, useState } from "react";
import Button from "./gds/Button.tsx";
import Badge from "./gds/Badge.tsx";
import Icon from "./gds/Icon.tsx";
import ScrollingText from "./gds/ScrollingText.tsx";
import Chat from "./Chat.tsx";
import Accordion from "./gds/Accordion.tsx";
import { useBuildChat } from "./BuildChatContext.tsx";
import List from "./gds/List.tsx";
import ListItem from "./gds/ListItem.tsx";
import {
  chatAccordionEnabled,
  extractGradingFlags,
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

type WorkbenchDrawerFeedbackItem = {
  entry: FeedbackEntry;
  message?: { content?: string } | null;
  role?: string | null;
};

type WorkbenchDrawerRunItem = {
  turnNumber?: number;
  input?: unknown;
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
  feedbackItems?: WorkbenchDrawerFeedbackItem[];
  gradingFlags?: GradingFlag[];
  runLabelById?: Map<string, string>;
  runItemByRefId?: Map<string, WorkbenchDrawerRunItem>;
};

export default function WorkbenchDrawer(props: WorkbenchDrawerProps) {
  const { run, chatSending, resetChat, loadChat } = useBuildChat();
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
          });
        });
      } else {
        map.set(`gradingRun:${record.id}`, {
          input: record.input,
        });
      }
    });
    return map;
  }, [runItemByRefId, sessionDetail]);
  const loadChatHistory = useCallback(async () => {
    if (!chatAccordionEnabled) return;
    setChatHistoryLoading(true);
    setChatHistoryError(null);
    try {
      const res = await fetch("/api/build/runs");
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as {
        runs?: Array<{ id?: string; updatedAt?: string; startedAt?: string }>;
      };
      const runs = Array.isArray(data.runs)
        ? data.runs.filter((entry) => typeof entry?.id === "string").map(
          (entry) => ({
            id: entry.id as string,
            updatedAt: entry.updatedAt,
            startedAt: entry.startedAt,
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
      window.setTimeout(() => setCopiedStatePath(false), 1200);
    };
  }, [resolvedStatePath]);
  useEffect(() => {
    if (!open) return;
    if (!onClose) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <aside className="workbench-drawer-docked" role="dialog">
      <header className="workbench-drawer-header">
        <strong>Workbench</strong>
        {onClose && (
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </Button>
        )}
      </header>
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
                <Button
                  variant="secondary"
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    resetChat().then(() => {
                      loadChatHistory().catch(() => {});
                    });
                  }}
                  className="gds-accordion-open-only"
                  disabled={chatSending || run.status === "running"}
                >
                  New chat
                </Button>
              ),
              content: (
                <div className="workbench-chat-panel">
                  <div className="workbench-chat-overlay">
                    <div className="workbench-chat-history">
                      {chatHistoryLoading && (
                        <div className="placeholder">
                          Loading chat history…
                        </div>
                      )}
                      {chatHistoryError && (
                        <div className="error">{chatHistoryError}</div>
                      )}
                      {!chatHistoryLoading &&
                        !chatHistoryError &&
                        chatHistory.length === 0 && (
                        <div className="placeholder">
                          No previous chats yet.
                        </div>
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
                      <Chat />
                    </div>
                  </div>
                </div>
              ),
            }]
            : []),
          {
            id: "workbench-ratings",
            title: "Ratings & flags",
            defaultOpen: true,
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
                {loading && (
                  <div className="placeholder">Loading ratings and flags…</div>
                )}
                {error && <div className="error">{error}</div>}
                {!loading &&
                  !error &&
                  resolvedFeedbackItems.length === 0 &&
                  resolvedGradingFlags.length === 0 && (
                  <div className="placeholder">
                    No ratings or flags yet.
                  </div>
                )}
                {resolvedFeedbackItems.length > 0 && (
                  <div className="workbench-summary-list">
                    {resolvedFeedbackItems.map(({ entry, message, role }) => {
                      const roleLabel = role === "assistant"
                        ? "Assistant message"
                        : "Test bot message";
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
                        </div>
                      );
                    })}
                  </div>
                )}
                {resolvedGradingFlags.length > 0 && (
                  <div className="workbench-summary-list">
                    {resolvedGradingFlags.map((flag) => {
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
