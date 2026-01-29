import React, { useMemo, useState } from "react";
import Button from "./gds/Button.tsx";
import Icon from "./gds/Icon.tsx";
import Panel from "./gds/Panel.tsx";
import ScrollingText from "./gds/ScrollingText.tsx";
import {
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

type CalibrateDrawerFeedbackItem = {
  entry: FeedbackEntry;
  message?: { content?: string } | null;
  role?: string | null;
};

type CalibrateDrawerRunItem = {
  turnNumber?: number;
  input?: unknown;
};

type CalibrateDrawerProps = {
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
  feedbackItems?: CalibrateDrawerFeedbackItem[];
  gradingFlags?: GradingFlag[];
  runLabelById?: Map<string, string>;
  runItemByRefId?: Map<string, CalibrateDrawerRunItem>;
};

export default function CalibrateDrawer(props: CalibrateDrawerProps) {
  const {
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
      CalibrateDrawerFeedbackItem & { _sortIndex?: number }
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
    const map = new Map<string, CalibrateDrawerRunItem>();
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
  const showCopyStatePath = Boolean(resolvedStatePath);
  const handleCopyStatePath = useMemo(() => {
    if (!resolvedStatePath) return null;
    return () => {
      navigator.clipboard?.writeText(resolvedStatePath);
      setCopiedStatePath(true);
      window.setTimeout(() => setCopiedStatePath(false), 1200);
    };
  }, [resolvedStatePath]);
  return (
    <Panel as="aside" className="calibrate-drawer">
      <div className="drawer-section">
        <strong>Calibrate</strong>
        {showCopyStatePath && handleCopyStatePath && (
          <>
            <Button variant="secondary" onClick={handleCopyStatePath}>
              <Icon
                name={copiedStatePath ? "copied" : "copy"}
                size={14}
              />
              {copiedStatePath ? "Copied" : "Copy state path"}
            </Button>
            <p className="calibrate-button-meta">
              Paste this in your coding assistant to debug the agent.
            </p>
          </>
        )}
        <h3>Ratings & flags</h3>
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
          <div className="calibrate-summary-list">
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
                  className="calibrate-summary-card"
                >
                  <div
                    className="calibrate-summary-title"
                    title={entry.createdAt &&
                      formatTimestampShort(entry.createdAt)}
                  >
                    {roleLabel}
                  </div>
                  <div className="calibrate-summary-score-row">
                    <div
                      className={`calibrate-score-badge calibrate-score-badge--small ${scoreClass}`}
                    >
                      {scoreLabel}
                    </div>
                    {entry.reason && (
                      <ScrollingText
                        as="div"
                        text={entry.reason}
                        className="calibrate-summary-reason"
                      />
                    )}
                  </div>
                  {message?.content && (
                    <ScrollingText
                      as="div"
                      text={formatSnippet(message.content)}
                      className="calibrate-summary-meta"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {resolvedGradingFlags.length > 0 && (
          <div className="calibrate-summary-list">
            {resolvedGradingFlags.map((flag) => {
              const runLabel = flag.runId
                ? resolvedRunLabelById.get(flag.runId)
                : undefined;
              const flaggedItem = resolvedRunItemByRefId.get(flag.refId);
              const turnLabel = flaggedItem?.turnNumber
                ? `Assistant turn ${flaggedItem.turnNumber}`
                : undefined;
              const gradedAssistant = extractTurnContext(
                flaggedItem?.input,
              ).gradedAssistant;
              return (
                <div
                  key={flag.id}
                  className="calibrate-summary-card calibrate-flag-card"
                >
                  <div className="calibrate-summary-title">Grader flag</div>
                  {(runLabel || turnLabel)
                    ? (
                      <div
                        className="calibrate-summary-subtitle"
                        title={flag.createdAt &&
                          formatTimestampShort(flag.createdAt)}
                      >
                        {runLabel}
                        {runLabel && turnLabel && " • "}
                        {turnLabel}
                      </div>
                    )
                    : "Flagged grader"}
                  <div className="calibrate-summary-score-row">
                    <div className="calibrate-score-badge calibrate-score-badge--small">
                      <Icon name="flag" size={10} />
                    </div>
                    {flag.reason && (
                      <ScrollingText
                        as="div"
                        text={flag.reason}
                        className="calibrate-summary-reason"
                      />
                    )}
                  </div>
                  {gradedAssistant && (
                    <ScrollingText
                      as="div"
                      text={formatSnippet(gradedAssistant)}
                      className="calibrate-summary-meta"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}
