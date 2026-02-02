import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CalibrateDrawer from "./CalibrateDrawer.tsx";
import Button from "./gds/Button.tsx";
import Badge from "./gds/Badge.tsx";
import Icon from "./gds/Icon.tsx";
import Listbox from "./gds/Listbox.tsx";
import {
  botFilename,
  buildDurableStreamUrl,
  buildGradePath,
  classNames,
  extractGradingFlags,
  extractScoreAndReason,
  extractTotalTurns,
  extractTotalTurnsFromResult,
  extractTurnContext,
  formatTimestampShort,
  getDurableStreamOffset,
  getGradeRefFromLocation,
  getGradeSessionIdFromLocation,
  getScoreClass,
  GRADE_STREAM_ID,
  isTurnsResult,
  parseGradingRef,
  setDurableStreamOffset,
} from "./utils.ts";
import type {
  CalibrateRef,
  CalibrateResponse,
  CalibrateSession,
  CalibrateStreamMessage,
  CalibrationRun,
  GraderDeckMeta,
  GradingFlag,
  SessionDetailResponse,
} from "./utils.ts";
import PageGrid from "./gds/PageGrid.tsx";
import PageShell from "./gds/PageShell.tsx";
import Panel from "./gds/Panel.tsx";

function GradePage(
  { setNavActions, onAppPathChange, activeSessionId }: {
    setNavActions?: (actions: React.ReactNode | null) => void;
    onAppPathChange?: (path: string) => void;
    activeSessionId?: string | null;
  },
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graders, setGraders] = useState<GraderDeckMeta[]>([]);
  const [sessions, setSessions] = useState<CalibrateSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [selectedGraderId, setSelectedGraderId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sessionDetail, setSessionDetail] = useState<
    SessionDetailResponse | null
  >(null);
  const [sessionDetailError, setSessionDetailError] = useState<string | null>(
    null,
  );
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const initialCalibrateSessionRef = useRef<string | null>(
    getGradeSessionIdFromLocation(),
  );
  const initialCalibrateRef = useRef<CalibrateRef>(
    (() => {
      const ref = getGradeRefFromLocation();
      return ref ? parseGradingRef(ref) : {};
    })(),
  );

  const updateCalibratePath = useCallback((
    sessionId: string | null,
    opts?: { ref?: string | null },
  ) => {
    const targetPath = sessionId ? buildGradePath(sessionId) : "/grade";
    if (window.location.pathname === targetPath) return;
    const url = new URL(window.location.href);
    url.pathname = targetPath;
    if (!sessionId) {
      url.searchParams.delete("sessionId");
    }
    if (opts?.ref) {
      url.searchParams.set("ref", opts.ref);
    } else {
      url.searchParams.delete("ref");
    }
    window.history.replaceState({}, "", url.toString());
    onAppPathChange?.(targetPath);
  }, [onAppPathChange]);

  const loadCalibrateData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/calibrate");
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as CalibrateResponse;
      const nextGraders = Array.isArray(data.graderDecks)
        ? data.graderDecks
        : [];
      const nextSessions = Array.isArray(data.sessions) ? data.sessions : [];
      setGraders(nextGraders);
      setSessions(nextSessions);
      setSelectedSessionId((prev) => {
        const requested = initialCalibrateSessionRef.current;
        if (
          requested && nextSessions.some((session) => session.id === requested)
        ) {
          initialCalibrateSessionRef.current = null;
          return requested;
        }
        if (prev && nextSessions.some((session) => session.id === prev)) {
          return prev;
        }
        return nextSessions[0]?.id ?? null;
      });
      setSelectedGraderId((prev) => {
        if (prev && nextGraders.some((grader) => grader.id === prev)) {
          return prev;
        }
        return nextGraders[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load calibration data",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCalibrateData();
  }, [loadCalibrateData]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (activeSessionId === selectedSessionId) return;
    setSelectedSessionId(activeSessionId);
  }, [activeSessionId, selectedSessionId]);

  useEffect(() => {
    const streamId = GRADE_STREAM_ID;
    const streamUrl = buildDurableStreamUrl(
      streamId,
      getDurableStreamOffset(streamId),
    );
    const source = new EventSource(streamUrl);

    source.onmessage = (event) => {
      let envelope: { offset?: unknown; data?: unknown } | null = null;
      try {
        envelope = JSON.parse(event.data) as {
          offset?: unknown;
          data?: unknown;
        };
      } catch {
        return;
      }
      if (
        envelope &&
        typeof envelope.offset === "number" &&
        Number.isFinite(envelope.offset)
      ) {
        setDurableStreamOffset(streamId, envelope.offset + 1);
      }
      const msg = envelope?.data as CalibrateStreamMessage | undefined;
      if (!msg || msg.type !== "calibrateSession") return;
      setSessions((prev) => {
        const next = [...prev];
        const index = next.findIndex((sess) => sess.id === msg.session.id);
        if (index >= 0) {
          next[index] = msg.session;
          return next;
        }
        return [msg.session, ...next];
      });
    };

    return () => {
      source.close();
    };
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      updateCalibratePath(selectedSessionId);
    } else {
      updateCalibratePath(null);
    }
  }, [selectedSessionId, updateCalibratePath]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      setSessionDetailError(null);
      setSessionDetailLoading(false);
      return;
    }
    let active = true;
    const loadSessionDetail = async () => {
      try {
        setSessionDetailLoading(true);
        setSessionDetail(null);
        setSessionDetailError(null);
        const res = await fetch(
          `/api/session?sessionId=${encodeURIComponent(selectedSessionId)}`,
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        const data = await res.json() as SessionDetailResponse;
        if (!active) return;
        setSessionDetail(data);
        setSessionDetailError(null);
      } catch (err) {
        if (!active) return;
        setSessionDetailError(
          err instanceof Error ? err.message : "Failed to load session details",
        );
        setSessionDetail(null);
      } finally {
        if (active) setSessionDetailLoading(false);
      }
    };
    loadSessionDetail();
    return () => {
      active = false;
    };
  }, [selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );
  const selectedGrader = useMemo(
    () => graders.find((grader) => grader.id === selectedGraderId) ?? null,
    [graders, selectedGraderId],
  );
  const sessionRuns = useMemo(() => {
    if (!selectedSession?.gradingRuns) return [];
    return [...selectedSession.gradingRuns].reverse();
  }, [selectedSession]);
  const runSections = useMemo(() => {
    return sessionRuns.map((run) => {
      const items: Array<{
        key: string;
        label: string;
        status: CalibrationRun["status"];
        runAt?: string;
        error?: string;
        input?: unknown;
        result?: unknown;
        messageIndex?: number;
        runId: string;
        turnIndex?: number;
        turnNumber?: number;
        refId: string;
        pending?: boolean;
      }> = [];
      const result = run.result;
      if (
        result && typeof result === "object" && "mode" in result &&
        (result as { mode?: unknown }).mode === "turns" &&
        Array.isArray((result as { turns?: unknown }).turns)
      ) {
        const turns = (result as { turns?: unknown })
          .turns as Array<{
            index?: number;
            input?: unknown;
            result?: unknown;
          }>;
        const turnsDescending = [...turns].reverse();
        turnsDescending.forEach((turn, idx) => {
          const assistantTurnNumber = turns.length - idx;
          items.push({
            key: `${run.id}-${turn.index ?? idx}`,
            label: `Assistant turn ${assistantTurnNumber}`,
            status: run.status,
            runAt: run.runAt,
            error: run.error,
            input: turn.input,
            result: turn.result,
            messageIndex: turn.index ?? idx,
            runId: run.id,
            turnIndex: turn.index ?? idx,
            turnNumber: assistantTurnNumber,
            refId: `gradingRun:${run.id}#turn:${turn.index ?? idx}`,
          });
        });
        if (run.status === "running") {
          const pendingTurnNumber = turns.length + 1;
          items.unshift({
            key: `${run.id}-turn-pending-${pendingTurnNumber}`,
            label: `Assistant turn ${pendingTurnNumber}`,
            status: "running",
            runAt: run.runAt,
            runId: run.id,
            turnNumber: pendingTurnNumber,
            refId: `gradingRun:${run.id}#turn:${pendingTurnNumber}`,
            pending: true,
          });
        }
        if (turns.length === 0 && run.status !== "running") {
          items.push({
            key: `${run.id}-empty`,
            label: "Turns",
            status: run.status,
            runAt: run.runAt,
            error: run.error,
            input: run.input,
            result: run.result,
            runId: run.id,
            refId: `gradingRun:${run.id}`,
          });
        }
      } else {
        if (run.status === "running") {
          items.push({
            key: `${run.id}-pending`,
            label: "Result",
            status: "running",
            runAt: run.runAt,
            runId: run.id,
            refId: `gradingRun:${run.id}`,
            pending: true,
          });
        } else {
          items.push({
            key: run.id,
            label: "Result",
            status: run.status,
            runAt: run.runAt,
            error: run.error,
            input: run.input,
            result: run.result,
            runId: run.id,
            refId: `gradingRun:${run.id}`,
          });
        }
      }
      return {
        run,
        label: run.graderLabel ?? run.graderId,
        items,
      };
    });
  }, [sessionRuns]);
  const runItems = useMemo(
    () => runSections.flatMap((section) => section.items),
    [runSections],
  );
  const runLabelById = useMemo(() => {
    const map = new Map<string, string>();
    runSections.forEach((section) => {
      map.set(section.run.id, section.label);
    });
    return map;
  }, [runSections]);
  const runItemByRefId = useMemo(() => {
    const map = new Map<string, (typeof runItems)[number]>();
    runItems.forEach((item) => {
      map.set(item.refId, item);
    });
    return map;
  }, [runItems]);
  const gradingFlags = useMemo(
    () => extractGradingFlags(sessionDetail?.meta),
    [sessionDetail?.meta],
  );
  const gradingFlagByRefId = useMemo(() => {
    const map = new Map<string, GradingFlag>();
    gradingFlags.forEach((flag) => {
      map.set(flag.refId, flag);
    });
    return map;
  }, [gradingFlags]);
  const flaggedRefSet = useMemo(() => {
    return new Set(gradingFlags.map((flag) => flag.refId));
  }, [gradingFlags]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const prevRunIdsRef = useRef<string[]>([]);
  const [expandedResults, setExpandedResults] = useState<
    Record<string, boolean>
  >({});
  const [highlightedResult, setHighlightedResult] = useState<string | null>(
    null,
  );
  const [flagReasonDrafts, setFlagReasonDrafts] = useState<
    Record<string, string>
  >({});
  const flagReasonTimeoutsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const ref = initialCalibrateRef.current;
    if (!ref.runId) return;
    const match = runItems.find((item) =>
      item.runId === ref.runId &&
      (ref.turnIndex === undefined || item.turnIndex === ref.turnIndex)
    );
    if (!match) return;
    setExpandedResults((prev) => ({ ...prev, [match.key]: true }));
    setHighlightedResult(match.key);
    setExpandedRunId(ref.runId);
  }, [runItems]);
  useEffect(() => {
    const latestRunId = runSections[0]?.run.id ?? null;
    const nextRunIds = runSections.map((section) => section.run.id);
    const prevRunIds = prevRunIdsRef.current;
    const hasNewLatest = latestRunId
      ? !prevRunIds.includes(latestRunId)
      : false;

    if (!latestRunId) {
      setExpandedRunId(null);
    } else if (
      hasNewLatest ||
      (expandedRunId && !nextRunIds.includes(expandedRunId)) ||
      (!expandedRunId && prevRunIds.length === 0)
    ) {
      setExpandedRunId(latestRunId);
    }

    prevRunIdsRef.current = nextRunIds;
  }, [expandedRunId, runSections]);

  useEffect(() => {
    return () => {
      const timers = flagReasonTimeoutsRef.current;
      Object.values(timers).forEach((handle) => clearTimeout(handle));
      flagReasonTimeoutsRef.current = {};
    };
  }, []);

  const toggleFlag = useCallback(async (item: {
    refId: string;
    runId: string;
    turnIndex?: number;
  }) => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch("/api/calibrate/flag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          refId: item.refId,
          runId: item.runId,
          turnIndex: item.turnIndex,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = await res.json() as {
        flags?: GradingFlag[];
      };
      if (!data.flags) return;
      setSessionDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          meta: {
            ...(prev.meta ?? {}),
            gradingFlags: data.flags,
          },
        };
      });
      setFlagReasonDrafts((prev) => {
        const next = { ...prev };
        const isNowFlagged = data.flags?.some((flag) =>
          flag.refId === item.refId
        );
        if (!isNowFlagged) {
          const timers = flagReasonTimeoutsRef.current;
          if (timers[item.refId]) {
            clearTimeout(timers[item.refId]);
            delete timers[item.refId];
          }
          delete next[item.refId];
          return next;
        }
        const flag = data.flags?.find((entry) => entry.refId === item.refId);
        if (flag?.reason) {
          next[item.refId] = flag.reason;
        } else {
          next[item.refId] = "";
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to flag grader");
    }
  }, [selectedSessionId]);

  const updateFlagReason = useCallback(
    async (refId: string, reason: string) => {
      if (!selectedSessionId) return;
      try {
        const res = await fetch("/api/calibrate/flag/reason", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: selectedSessionId,
            refId,
            reason,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        const data = await res.json() as { flags?: GradingFlag[] };
        if (!data.flags) return;
        setSessionDetail((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            meta: {
              ...(prev.meta ?? {}),
              gradingFlags: data.flags,
            },
          };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save reason");
      }
    },
    [selectedSessionId],
  );

  const scheduleFlagReasonSave = useCallback((
    refId: string,
    reason: string,
  ) => {
    const timers = flagReasonTimeoutsRef.current;
    if (timers[refId]) {
      clearTimeout(timers[refId]);
    }
    timers[refId] = window.setTimeout(() => {
      updateFlagReason(refId, reason);
      delete timers[refId];
    }, 650);
  }, [updateFlagReason]);

  const runGrader = useCallback(async () => {
    if (!selectedSessionId || !selectedGraderId) return;
    try {
      setRunning(true);
      const res = await fetch("/api/calibrate/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          graderId: selectedGraderId,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = await res.json() as {
        session?: CalibrateSession;
      };
      if (data.session) {
        setSessions((prev) => {
          const index = prev.findIndex((sess) => sess.id === data.session!.id);
          if (index >= 0) {
            const next = [...prev];
            next[index] = data.session!;
            return next;
          }
          return [data.session!, ...prev];
        });
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run grader");
    } finally {
      setRunning(false);
    }
  }, [selectedSessionId, selectedGraderId]);

  const canRun = Boolean(selectedSessionId && selectedGraderId && !running);

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(null);
    return () => setNavActions(null);
  }, [setNavActions]);

  return (
    <PageShell className="calibrate-shell">
      <PageGrid as="main" className="calibrate-layout">
        <Panel
          className="calibrate-runner"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div className="flex-row gap-8 items-center">
            <div className="flex-1">
              <strong>Run a grader</strong>
            </div>
            <Button
              variant="primary"
              onClick={runGrader}
              disabled={!canRun}
            >
              {running ? "Running…" : "Run grader"}
            </Button>
          </div>
          {sessions.length === 0 && (
            <div className="placeholder">
              No sessions found. Run the Test view to capture a session before
              calibrating.
            </div>
          )}
          {graders.length === 0 && (
            <div className="placeholder">
              No grader decks found. Add <code>[[graders]]</code> (or legacy
              {" "}
              <code>[[graderDecks]]</code>) to your deck front matter to surface
              graders here.
            </div>
          )}
          {sessions.length > 0 && graders.length > 0 && (
            <>
              <Listbox
                label="Grader"
                value={selectedGraderId ?? ""}
                onChange={(value) =>
                  setSelectedGraderId(value.length ? value : null)}
                options={graders.map((grader) => ({
                  value: grader.id,
                  label: grader.label,
                  meta: botFilename(grader.path ?? null) ?? undefined,
                }))}
                placeholder="Select grader"
              />
              {selectedGrader?.description && (
                <div className="placeholder">
                  {selectedGrader.description}
                </div>
              )}
            </>
          )}
        </Panel>
        <Panel
          className="calibrate-results"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {error && <div className="error">{error}</div>}
          {loading && (
            <div className="editor-status">Loading calibration data…</div>
          )}
          {!loading && (
            <>
              <div className="flex-column gap-4">
                <div className="flex-row items-center gap-8">
                  <strong>Grader runs</strong>
                </div>
              </div>
              {runItems.length === 0 && (
                <div className="placeholder">
                  No grader runs for this session yet.
                </div>
              )}
              {runSections.map((section) => {
                const isExpanded = expandedRunId === section.run.id;
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
                      entry.turnNumber === turnLabel || (
                        entry.pending &&
                        entry.turnNumber === turnLabel
                      )
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
                        item.refId && flaggedRefSet.has(item.refId),
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
                        item.refId && flaggedRefSet.has(item.refId),
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
                      onClick={() =>
                        setExpandedRunId((prev) =>
                          prev === section.run.id ? null : section.run.id
                        )}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setExpandedRunId((prev) =>
                            prev === section.run.id ? null : section.run.id
                          );
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
                          const graded = extractScoreAndReason(
                            item.result,
                          );
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
                            expandedResults[item.key],
                          );
                          const isFlagged = flaggedRefSet.has(item.refId);
                          const showStatusBadge = item.status === "error" ||
                            !item.turnNumber;
                          return (
                            <div
                              key={item.key}
                              className={`calibrate-run-section${
                                highlightedResult === item.key
                                  ? " trace-row-highlight"
                                  : ""
                              }`}
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
                                        toggleFlag({
                                          refId: item.refId,
                                          runId: item.runId,
                                          turnIndex: item.turnIndex,
                                        })}
                                    >
                                      <Icon name="flag" size={14} />
                                      {isFlagged ? "Flagged" : "Flag"}
                                    </Button>
                                    <Button
                                      variant={isOpen
                                        ? "primary-deemph"
                                        : "ghost"}
                                      className="flex-1 calibrate-toggle"
                                      aria-label={isOpen
                                        ? "Hide raw input"
                                        : "Show raw input"}
                                      onClick={() =>
                                        setExpandedResults((prev) => ({
                                          ...prev,
                                          [item.key]: !isOpen,
                                        }))}
                                    >
                                      <Icon name="circleInfo" size={16} />
                                      {isOpen
                                        ? "Hide raw input"
                                        : "Show raw input"}
                                    </Button>
                                  </div>
                                )}
                              </div>
                              {isFlagged && !isPending && (
                                <div className="calibrate-flag-reason">
                                  <label>
                                    Reason
                                    <textarea
                                      value={flagReasonDrafts[
                                        item.refId
                                      ] ??
                                        gradingFlagByRefId.get(item.refId)
                                          ?.reason ??
                                        ""}
                                      placeholder="Why is this flagged?"
                                      onChange={(e) => {
                                        const nextReason = e.target.value;
                                        setFlagReasonDrafts((prev) => ({
                                          ...prev,
                                          [item.refId]: nextReason,
                                        }));
                                        scheduleFlagReasonSave(
                                          item.refId,
                                          nextReason,
                                        );
                                      }}
                                      onBlur={(e) => {
                                        scheduleFlagReasonSave(
                                          item.refId,
                                          e.target.value,
                                        );
                                      }}
                                    />
                                  </label>
                                </div>
                              )}
                              {item.error && (
                                <div className="error">{item.error}</div>
                              )}
                              {isOpen && (
                                <div className="calibrate-result-details">
                                  <div className="calibrate-section-title">
                                    Raw input
                                  </div>
                                  <pre className="trace-json">
                                        {JSON.stringify(
                                          item.input ?? null,
                                          null,
                                          2,
                                        )}
                                  </pre>
                                </div>
                              )}
                              {item.turnIndex !== undefined &&
                                !isPending && (
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
        </Panel>
        <CalibrateDrawer
          statePath={selectedSession?.statePath}
          loading={sessionDetailLoading}
          error={sessionDetailError}
          sessionId={selectedSessionId}
          sessionDetail={sessionDetail}
          runLabelById={runLabelById}
          runItemByRefId={runItemByRefId}
        />
      </PageGrid>
    </PageShell>
  );
}

export default GradePage;
