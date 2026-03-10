import {
  classNames,
  extractScoreAndReason,
  extractTotalTurns,
  extractTotalTurnsFromResult,
  extractTurnContext,
  formatTimestampShort,
  getScoreClass,
  isTurnsResult,
} from "../utils.ts";
import Badge from "../gds/Badge.tsx";
import Button from "../gds/Button.tsx";
import Callout from "../gds/Callout.tsx";
import Icon from "../gds/Icon.tsx";
import GradeRunsHeader from "./GradeRunsHeader.tsx";
import type { GradeRunSection } from "./types.ts";

export function GradeResultsPanel(props: {
  error: string | null;
  loading: boolean;
  runCount: number;
  runItemsCount: number;
  emptyMessage: string;
  routeRunNotFound: boolean;
  missingRunHref?: string;
  runSections: Array<GradeRunSection>;
  expandedRunId: string | null;
  onToggleRun: (runId: string) => void;
  expandedResults: Record<string, boolean>;
  onToggleExpandedResult: (itemKey: string) => void;
  flaggedRefSet: Set<string>;
  flagReasonDrafts: Record<string, string>;
  flagReasonByRefId: Map<string, { reason?: string }>;
  onToggleFlag: (
    args: { refId: string; runId: string; turnIndex?: number },
  ) => void;
  onFlagReasonChange: (refId: string, reason: string) => void;
  onFlagReasonBlur: (refId: string, reason: string) => void;
  onAddFlagToWorkbench?: (
    args: {
      refId: string;
      runId: string;
      turnIndex?: number;
      score?: number;
      graderReason?: string;
      flagReason?: string;
      priorUser?: string;
      gradedAssistant?: string;
    },
  ) => void;
  onAddErrorToWorkbench?: (args: { runId?: string; error: string }) => void;
  topErrorRunId?: string | null;
}) {
  return (
    <>
      {props.error && (
        <Callout
          variant="danger"
          title="Grader run failed"
          actions={props.onAddErrorToWorkbench
            ? (
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  props.onAddErrorToWorkbench?.({
                    runId: props.topErrorRunId ?? undefined,
                    error: props.error!,
                  })}
                data-testid="grade-add-error-to-chat"
              >
                Add to chat
              </Button>
            )
            : undefined}
          data-testid="grade-error-callout"
        >
          {props.error}
        </Callout>
      )}
      {props.loading && (
        <div className="editor-status">Loading calibration data…</div>
      )}
      {!props.loading && (
        <>
          <div data-testid="grade-history-title">
            <GradeRunsHeader count={props.runCount} />
          </div>
          {props.runItemsCount === 0 && <Callout>{props.emptyMessage}</Callout>}
          {props.routeRunNotFound && props.missingRunHref && (
            <Callout>
              Grade run not found for this workspace.{" "}
              <a href={props.missingRunHref}>
                Back to grade runs
              </a>
            </Callout>
          )}
          {props.runSections.map((section) => {
            const isExpanded = props.expandedRunId === section.run.id;
            const runModeTurns = isTurnsResult(section.run.result);
            const totalTurns = runModeTurns
              ? extractTotalTurnsFromResult(section.run.result) ??
                extractTotalTurns(section.run.input) ??
                extractTotalTurns(
                  section.items.find((item) => item.input)?.input,
                )
              : undefined;
            const isTurnRun = Boolean(
              runModeTurns ||
                section.items.some((item) =>
                  item.turnNumber !== undefined || item.pending
                ),
            );
            const turnBadges = isTurnRun
              ? Array.from({
                length: totalTurns ??
                  section.items.filter((item) =>
                    item.turnNumber !== undefined || item.pending
                  ).length,
              }).map((_, idx) => {
                const turnLabel = idx + 1;
                const item = section.items.find((entry) =>
                  entry.turnNumber === turnLabel ||
                  (entry.pending && entry.turnNumber === turnLabel)
                );
                if (item?.pending) {
                  return (
                    <span
                      key={`${section.run.id}-turn-${turnLabel}`}
                      className="calibrate-run-turn calibrate-run-turn--pending"
                      title={`Turn ${turnLabel}: running`}
                    >
                      <span
                        className="calibrate-spinner calibrate-spinner--tiny"
                        role="status"
                        aria-label="Grading"
                      />
                    </span>
                  );
                }
                if (item) {
                  const graded = extractScoreAndReason(item.result);
                  const displayScore = graded.score;
                  const scoreLabel = displayScore !== undefined &&
                      displayScore > 0
                    ? `+${displayScore}`
                    : displayScore;
                  const scoreClass = getScoreClass(displayScore);
                  const isFlagged = Boolean(
                    item.refId && props.flaggedRefSet.has(item.refId),
                  );
                  return (
                    <span
                      key={`${section.run.id}-turn-${turnLabel}`}
                      className={`calibrate-run-turn ${scoreClass}`}
                      title={`Turn ${turnLabel}: ${scoreLabel ?? "—"}${
                        isFlagged ? " (flagged)" : ""
                      }`}
                    >
                      {isFlagged && <Icon name="flag" size={10} />}
                    </span>
                  );
                }
                return (
                  <span
                    key={`${section.run.id}-turn-${turnLabel}`}
                    className="calibrate-run-turn calibrate-run-turn--empty"
                    title={`Turn ${turnLabel}: pending`}
                  />
                );
              })
              : (() => {
                const item = section.items[0];
                if (section.run.status === "running") {
                  return [
                    <span
                      key={`${section.run.id}-pending`}
                      className="calibrate-run-turn calibrate-run-turn--pending"
                      title="Running"
                    >
                      <span
                        className="calibrate-spinner calibrate-spinner--tiny"
                        role="status"
                        aria-label="Grading"
                      />
                    </span>,
                  ];
                }
                if (item) {
                  const graded = extractScoreAndReason(item.result);
                  const displayScore = graded.score;
                  const scoreLabel = displayScore !== undefined &&
                      displayScore > 0
                    ? `+${displayScore}`
                    : displayScore;
                  const scoreClass = getScoreClass(displayScore);
                  const isFlagged = Boolean(
                    item.refId && props.flaggedRefSet.has(item.refId),
                  );
                  return [
                    <span
                      key={`${section.run.id}-result`}
                      className={`calibrate-run-turn ${scoreClass}`}
                      title={`Result: ${scoreLabel ?? "—"}${
                        isFlagged ? " (flagged)" : ""
                      }`}
                    >
                      {isFlagged && <Icon name="flag" size={10} />}
                    </span>,
                  ];
                }
                return [];
              })();
            return (
              <div
                key={section.run.id}
                className="calibrate-run-card"
                data-testid={`grade-run-${section.run.id}`}
              >
                <div
                  className={classNames(
                    "calibrate-run-header",
                    isExpanded && "active",
                  )}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-controls={`calibrate-run-body-${section.run.id}`}
                  onClick={() => props.onToggleRun(section.run.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      props.onToggleRun(section.run.id);
                    }
                  }}
                >
                  <div>
                    <div className="calibrate-run-title-row">
                      <div className="calibrate-run-title">
                        {section.label}
                      </div>
                      <div className="calibrate-run-turns">
                        {turnBadges}
                      </div>
                    </div>
                    <div className="calibrate-run-subtitle">
                      <Badge status={section.run.status}>
                        {section.run.status}
                      </Badge>
                      {section.run.runAt
                        ? ` · ${formatTimestampShort(section.run.runAt)}`
                        : ""}
                    </div>
                  </div>
                  <div className="calibrate-run-toggle-icon">
                    <Icon
                      name="chevronDown"
                      size={10}
                    />
                  </div>
                </div>
                {isExpanded && (
                  <div
                    className="calibrate-run-body"
                    id={`calibrate-run-body-${section.run.id}`}
                  >
                    {section.items.map((item) => {
                      const graded = extractScoreAndReason(item.result);
                      const displayScore = graded.score;
                      const displayReason = graded.reason;
                      const scoreLabel = displayScore !== undefined &&
                          displayScore > 0
                        ? `+${displayScore}`
                        : displayScore;
                      const turnContext = extractTurnContext(
                        item.input,
                      );
                      const isPending = Boolean(item.pending);
                      const scoreClass = getScoreClass(displayScore);
                      const isOpen = !isPending && Boolean(
                        props.expandedResults[item.key],
                      );
                      const isFlagged = props.flaggedRefSet.has(item.refId);
                      const showStatusBadge = item.status === "error" ||
                        !item.turnNumber;
                      return (
                        <div
                          key={item.key}
                          className="calibrate-run-section"
                        >
                          <div className="calibrate-result-header">
                            <div className="calibrate-result-main">
                              <div
                                className={`calibrate-score-badge ${scoreClass}${
                                  isPending
                                    ? " calibrate-score-badge--pending"
                                    : ""
                                }`}
                              >
                                {isPending
                                  ? (
                                    <span
                                      className="calibrate-spinner"
                                      role="status"
                                      aria-label="Grading"
                                    />
                                  )
                                  : displayScore !== undefined
                                  ? scoreLabel
                                  : "—"}
                              </div>
                              <div className="calibrate-result-meta">
                                <div className="calibrate-result-title">
                                  {item.label}
                                  {showStatusBadge && (
                                    <Badge
                                      status={item.status}
                                      title={item.runAt
                                        ? formatTimestampShort(item.runAt)
                                        : undefined}
                                    >
                                      {item.status}
                                    </Badge>
                                  )}
                                </div>
                                {displayReason && !isPending && (
                                  <div className="calibrate-result-reason">
                                    {displayReason}
                                  </div>
                                )}
                                {isPending && (
                                  <div className="calibrate-result-secondary">
                                    Grading…
                                  </div>
                                )}
                              </div>
                            </div>
                            {!isPending && (
                              <div className="calibrate-result-actions">
                                <Button
                                  variant={isFlagged
                                    ? "primary-deemph"
                                    : "ghost"}
                                  className={classNames(
                                    "flex-1",
                                    "calibrate-flag-btn",
                                    isFlagged && "active",
                                  )}
                                  aria-label={isFlagged ? "Unflag" : "Flag"}
                                  onClick={() =>
                                    props.onToggleFlag({
                                      refId: item.refId,
                                      runId: item.runId,
                                      turnIndex: item.turnIndex,
                                    })}
                                >
                                  <Icon name="flag" size={14} />
                                  {isFlagged ? "Flagged" : "Flag"}
                                </Button>
                                <Button
                                  variant={isOpen ? "primary-deemph" : "ghost"}
                                  className="flex-1 calibrate-toggle"
                                  aria-label={isOpen
                                    ? "Hide raw input"
                                    : "Show raw input"}
                                  onClick={() =>
                                    props.onToggleExpandedResult(item.key)}
                                >
                                  <Icon name="circleInfo" size={16} />
                                  {isOpen ? "Hide raw input" : "Show raw input"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  className="flex-1 calibrate-toggle"
                                  disabled={!props.onAddFlagToWorkbench}
                                  data-testid="grade-flag-add-to-chat"
                                  onClick={() =>
                                    props.onAddFlagToWorkbench?.({
                                      refId: item.refId,
                                      runId: item.runId,
                                      turnIndex: item.turnIndex,
                                      score: displayScore,
                                      graderReason: displayReason ?? undefined,
                                      flagReason:
                                        props.flagReasonDrafts[item.refId] ??
                                          props.flagReasonByRefId.get(
                                            item.refId,
                                          )
                                            ?.reason ??
                                          undefined,
                                      priorUser: turnContext.priorUser,
                                      gradedAssistant:
                                        turnContext.gradedAssistant,
                                    })}
                                >
                                  <Icon name="chat" size={16} />
                                  Add to chat
                                </Button>
                              </div>
                            )}
                          </div>
                          {isFlagged && !isPending && (
                            <div className="calibrate-flag-reason">
                              <label>
                                Reason
                                <textarea
                                  value={props.flagReasonDrafts[item.refId] ??
                                    props.flagReasonByRefId.get(item.refId)
                                      ?.reason ??
                                    ""}
                                  placeholder="Why is this flagged?"
                                  onChange={(e) =>
                                    props.onFlagReasonChange(
                                      item.refId,
                                      e.target.value,
                                    )}
                                  onBlur={(e) =>
                                    props.onFlagReasonBlur(
                                      item.refId,
                                      e.target.value,
                                    )}
                                />
                              </label>
                            </div>
                          )}
                          {item.error && (
                            <Callout
                              variant="danger"
                              title="Grade run failed"
                              actions={props.onAddErrorToWorkbench
                                ? (
                                  <Button
                                    variant="secondary"
                                    size="small"
                                    onClick={() =>
                                      props.onAddErrorToWorkbench?.({
                                        runId: item.runId,
                                        error: item.error!,
                                      })}
                                    data-testid="grade-run-add-error-to-chat"
                                  >
                                    Add to chat
                                  </Button>
                                )
                                : undefined}
                              data-testid="grade-run-error-callout"
                            >
                              {item.error}
                            </Callout>
                          )}
                          {isOpen && (
                            <div className="calibrate-result-details">
                              <div className="calibrate-section-title">
                                Raw input
                              </div>
                              <pre className="trace-json">
                                {item.input === undefined
                                  ? "Raw input unavailable for this grade result."
                                  : JSON.stringify(item.input, null, 2)}
                              </pre>
                            </div>
                          )}
                          {item.turnIndex !== undefined && !isPending && (
                            <div className="calibrate-context calibrate-context-compact">
                              {turnContext.priorUser && (
                                <div className="calibrate-context-row">
                                  <div className="calibrate-context-label">
                                    Prior user
                                  </div>
                                  <div className="calibrate-context-bubble calibrate-context-user">
                                    {turnContext.priorUser}
                                  </div>
                                </div>
                              )}
                              {turnContext.gradedAssistant && (
                                <div className="calibrate-context-row">
                                  <div className="calibrate-context-label">
                                    Graded assistant
                                  </div>
                                  <div className="calibrate-context-bubble calibrate-context-assistant">
                                    {turnContext.gradedAssistant}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

export default GradeResultsPanel;
