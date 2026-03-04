// @ts-nocheck
// deno-lint-ignore-file
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  botFilename,
  buildGradePath,
  extractGradingFlags,
  getGradeWorkspaceIdFromLocation,
  scenarioNameFromValue,
} from "./utils.ts";
import type { CalibrationRun, GradingFlag } from "./utils.ts";
import { useWorkspaceGrade, useWorkspaceRouting } from "./WorkspaceContext.tsx";
import GradeTabShell from "./grade/GradeTabShell.tsx";
import GradeRunnerPanel from "./grade/GradeRunnerPanel.tsx";
import GradeResultsPanel from "./grade/GradeResultsPanel.tsx";

type ScenarioRunSummary = {
  scenarioRunId: string;
  lastEventSeq?: number;
  updatedAt?: string;
  selectedScenarioDeckId?: string;
  selectedScenarioDeckLabel?: string;
  scenarioConfigPath?: string;
};

const parseScenarioRunSummary = (value: unknown): ScenarioRunSummary | null => {
  if (!value || typeof value !== "object") return null;
  const summary = value as Record<string, unknown>;
  const scenarioRunId = typeof summary.scenarioRunId === "string"
    ? summary.scenarioRunId
    : null;
  if (!scenarioRunId) return null;
  return {
    scenarioRunId,
    lastEventSeq: typeof summary.lastEventSeq === "number" &&
        Number.isFinite(summary.lastEventSeq)
      ? summary.lastEventSeq
      : undefined,
    updatedAt: typeof summary.updatedAt === "string"
      ? summary.updatedAt
      : undefined,
    selectedScenarioDeckId: typeof summary.selectedScenarioDeckId === "string"
      ? summary.selectedScenarioDeckId
      : undefined,
    selectedScenarioDeckLabel:
      typeof summary.selectedScenarioDeckLabel === "string"
        ? summary.selectedScenarioDeckLabel
        : undefined,
    scenarioConfigPath: typeof summary.scenarioConfigPath === "string"
      ? summary.scenarioConfigPath
      : undefined,
  };
};

const getScenarioTitle = (summary: ScenarioRunSummary): string => {
  const fromDeckLabel = typeof summary.selectedScenarioDeckLabel === "string" &&
      summary.selectedScenarioDeckLabel.trim().length > 0
    ? summary.selectedScenarioDeckLabel
    : null;
  const fromDeckId = typeof summary.selectedScenarioDeckId === "string" &&
      summary.selectedScenarioDeckId.trim().length > 0
    ? scenarioNameFromValue(summary.selectedScenarioDeckId) ??
      summary.selectedScenarioDeckId
    : null;
  const fromPath = scenarioNameFromValue(summary.scenarioConfigPath ?? null) ??
    botFilename(summary.scenarioConfigPath ?? null);
  return fromDeckLabel ?? fromDeckId ?? fromPath ?? summary.scenarioRunId;
};

const scenarioRunIdFromCalibrationRun = (
  run: CalibrationRun,
): string | null => {
  if (!run.input || typeof run.input !== "object") return null;
  const input = run.input as Record<string, unknown>;
  const session = input.session;
  if (!session || typeof session !== "object") return null;
  const meta = (session as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const scenarioRunId = (meta as { scenarioRunId?: unknown }).scenarioRunId;
  return typeof scenarioRunId === "string" && scenarioRunId.trim().length > 0
    ? scenarioRunId
    : null;
};

function GradePage(
  {
    setNavActions,
    onAppPathChange,
    activeWorkspaceId,
    onFlagsUpdate,
    onOptimisticToggleFlag,
    onOptimisticFlagReason,
    onAddErrorToWorkbench,
    requestedGradeRunId,
  }: {
    setNavActions?: (actions: React.ReactNode | null) => void;
    onAppPathChange?: (path: string) => void;
    activeWorkspaceId?: string | null;
    onFlagsUpdate?: (flags: Array<GradingFlag>) => void;
    onOptimisticToggleFlag?: (item: {
      refId: string;
      runId: string;
      turnIndex?: number;
    }) => void;
    onOptimisticFlagReason?: (refId: string, reason: string) => void;
    onAddErrorToWorkbench?: (
      payload: {
        source?: "scenario_run_error" | "grader_run_error";
        workspaceId?: string;
        runId?: string;
        error: string;
      },
    ) => void;
    requestedGradeRunId?: string | null;
  },
) {
  const workspaceGrade = useWorkspaceGrade();
  const {
    loading,
    error,
    running,
    graders,
    sessions,
    sessionDetail,
    loadData,
    loadSessionDetail,
    runGrader: runGrade,
    toggleFlag: toggleGradeFlag,
    updateFlagReason: updateGradeFlagReason,
  } = workspaceGrade;
  const workspaceRouting = useWorkspaceRouting();
  const routedTestRunId = workspaceRouting.testRunId;
  const initialCalibrateSessionRef = useRef<string | null>(
    getGradeWorkspaceIdFromLocation(),
  );
  const [routeGradeRunId, setRouteGradeRunId] = useState<string | null>(
    requestedGradeRunId ?? null,
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    initialCalibrateSessionRef.current ?? activeWorkspaceId ?? null,
  );
  const [selectedTestRunId, setSelectedTestRunId] = useState<string | null>(
    null,
  );
  const [selectedGraderId, setSelectedGraderId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedSessionId((prev) => {
      if (activeWorkspaceId) return activeWorkspaceId;
      const requested = initialCalibrateSessionRef.current;
      if (requested && sessions.some((session) => session.id === requested)) {
        initialCalibrateSessionRef.current = null;
        return requested;
      }
      if (prev && sessions.some((session) => session.id === prev)) return prev;
      return sessions[0]?.id ?? null;
    });
  }, [activeWorkspaceId, sessions]);
  useEffect(() => {
    setSelectedGraderId((prev) => {
      if (prev && graders.some((grader) => grader.id === prev)) return prev;
      return graders[0]?.id ?? null;
    });
  }, [graders]);

  const updateCalibratePath = useCallback((
    sessionId: string | null,
    opts?: { gradeRunId?: string | null },
  ) => {
    const targetPath = sessionId
      ? buildGradePath(sessionId, opts?.gradeRunId ?? undefined)
      : "/grade";
    if (globalThis.location.pathname === targetPath) return;
    globalThis.history.replaceState({}, "", targetPath);
    onAppPathChange?.(targetPath);
  }, [onAppPathChange]);

  const loadCalibrateData = useCallback(async () => {
    await loadData({
      workspaceId: activeWorkspaceId,
      gradeRunId: requestedGradeRunId ?? null,
    });
  }, [activeWorkspaceId, loadData, requestedGradeRunId]);

  useEffect(() => {
    loadCalibrateData();
  }, [loadCalibrateData]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    if (activeWorkspaceId === selectedSessionId) return;
    setSelectedSessionId(activeWorkspaceId);
  }, [activeWorkspaceId, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    if (routeGradeRunId) return;
    updateCalibratePath(selectedSessionId);
  }, [routeGradeRunId, selectedSessionId, updateCalibratePath]);

  useEffect(() => {
    setRouteGradeRunId(requestedGradeRunId ?? null);
  }, [requestedGradeRunId]);

  useEffect(() => {
    loadSessionDetail(selectedSessionId).catch((err) => {
      console.error(err);
    });
  }, [loadSessionDetail, selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );
  const selectedGrader = useMemo(
    () => graders.find((grader) => grader.id === selectedGraderId) ?? null,
    [graders, selectedGraderId],
  );
  const testRunOptions = useMemo(() => {
    const meta = sessionDetail?.meta && typeof sessionDetail.meta === "object"
      ? sessionDetail.meta as Record<string, unknown>
      : {};
    const fromList = Array.isArray(meta.scenarioRunSummaries)
      ? meta.scenarioRunSummaries.map((entry) => parseScenarioRunSummary(entry))
      : [];
    const fromCurrent = parseScenarioRunSummary(meta.scenarioRunSummary);
    const all = [...fromList, fromCurrent].filter(
      (entry): entry is ScenarioRunSummary => Boolean(entry),
    );
    const deduped = new Map<string, ScenarioRunSummary>();
    all.forEach((entry) => {
      const existing = deduped.get(entry.scenarioRunId);
      if (!existing) {
        deduped.set(entry.scenarioRunId, entry);
        return;
      }
      const existingSeq = existing.lastEventSeq ?? -1;
      const nextSeq = entry.lastEventSeq ?? -1;
      if (nextSeq > existingSeq) {
        deduped.set(entry.scenarioRunId, entry);
        return;
      }
      if (nextSeq === existingSeq) {
        const existingStamp = existing.updatedAt ?? "";
        const nextStamp = entry.updatedAt ?? "";
        if (nextStamp.localeCompare(existingStamp) > 0) {
          deduped.set(entry.scenarioRunId, entry);
        }
      }
    });
    return [...deduped.values()].sort((a, b) => {
      const aTime = Date.parse(a.updatedAt ?? "");
      const bTime = Date.parse(b.updatedAt ?? "");
      const aValidTime = Number.isFinite(aTime) ? aTime : -1;
      const bValidTime = Number.isFinite(bTime) ? bTime : -1;
      if (aValidTime !== bValidTime) return bValidTime - aValidTime;
      const aSeq = a.lastEventSeq ?? -1;
      const bSeq = b.lastEventSeq ?? -1;
      if (aSeq !== bSeq) return bSeq - aSeq;
      return b.scenarioRunId.localeCompare(a.scenarioRunId);
    });
  }, [sessionDetail?.meta]);

  useEffect(() => {
    const hasOption = (runId: string | null | undefined): runId is string =>
      Boolean(
        runId &&
          testRunOptions.some((entry) => entry.scenarioRunId === runId),
      );
    const meta = sessionDetail?.meta && typeof sessionDetail.meta === "object"
      ? sessionDetail.meta as Record<string, unknown>
      : {};
    const currentScenarioRunId = typeof meta.scenarioRunId === "string" &&
        meta.scenarioRunId.trim().length > 0
      ? meta.scenarioRunId
      : null;
    const nextRunId = hasOption(routedTestRunId)
      ? routedTestRunId
      : hasOption(selectedTestRunId)
      ? selectedTestRunId
      : hasOption(currentScenarioRunId)
      ? currentScenarioRunId
      : testRunOptions[0]?.scenarioRunId ?? null;
    if (selectedTestRunId !== nextRunId) {
      setSelectedTestRunId(nextRunId);
    }
    if (routedTestRunId !== nextRunId) {
      workspaceRouting.setTestRunId(nextRunId);
    }
  }, [
    routedTestRunId,
    selectedTestRunId,
    sessionDetail?.meta,
    testRunOptions,
    workspaceRouting,
  ]);
  const sessionRuns = useMemo(() => {
    if (!selectedSession?.gradingRuns) return [];
    return [...selectedSession.gradingRuns].reverse();
  }, [selectedSession]);
  const filteredSessionRuns = useMemo(() => {
    if (!selectedTestRunId) return sessionRuns;
    return sessionRuns.filter((run) =>
      scenarioRunIdFromCalibrationRun(run) === selectedTestRunId
    );
  }, [selectedTestRunId, sessionRuns]);
  const runSections = useMemo(() => {
    return filteredSessionRuns.map((run) => {
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
  }, [filteredSessionRuns]);
  const runItems = useMemo(
    () => runSections.flatMap((section) => section.items),
    [runSections],
  );
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
  const [optimisticRunId, setOptimisticRunId] = useState<string | null>(null);
  const [expandedResults, setExpandedResults] = useState<
    Record<string, boolean>
  >({});
  const [flagReasonDrafts, setFlagReasonDrafts] = useState<
    Record<string, string>
  >({});
  const flagReasonTimeoutsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!routeGradeRunId) {
      setExpandedRunId(null);
      workspaceRouting.setGradeRunId(null);
      return;
    }
    setExpandedRunId(routeGradeRunId);
    workspaceRouting.setGradeRunId(routeGradeRunId);
  }, [routeGradeRunId, workspaceRouting]);
  useEffect(() => {
    if (!optimisticRunId) return;
    if (!sessionRuns.some((run) => run.id === optimisticRunId)) return;
    setOptimisticRunId(null);
  }, [optimisticRunId, sessionRuns]);
  useEffect(() => {
    if (!routeGradeRunId || !selectedTestRunId) return;
    const routeRun = sessionRuns.find((run) => run.id === routeGradeRunId);
    if (!routeRun) return;
    if (scenarioRunIdFromCalibrationRun(routeRun) === selectedTestRunId) return;
    setExpandedRunId(null);
    setRouteGradeRunId(null);
    setOptimisticRunId(null);
    workspaceRouting.setGradeRunId(null);
    updateCalibratePath(selectedSessionId, { gradeRunId: null });
  }, [
    routeGradeRunId,
    selectedSessionId,
    selectedTestRunId,
    sessionRuns,
    updateCalibratePath,
    workspaceRouting,
  ]);
  const routeRunNotFound = useMemo(
    () =>
      Boolean(
        routeGradeRunId &&
          routeGradeRunId !== optimisticRunId &&
          !sessionRuns.some((run) => run.id === routeGradeRunId),
      ),
    [optimisticRunId, routeGradeRunId, sessionRuns],
  );

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
    onOptimisticToggleFlag?.(item);
    try {
      const data = await toggleGradeFlag({
        workspaceId: selectedSessionId,
        refId: item.refId,
        runId: item.runId,
        turnIndex: item.turnIndex,
      }) as {
        flags?: Array<GradingFlag>;
      };
      if (!data.flags) return;
      onFlagsUpdate?.(data.flags);
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
      console.error(err);
    }
  }, [
    onFlagsUpdate,
    onOptimisticToggleFlag,
    selectedSessionId,
    toggleGradeFlag,
  ]);

  const updateFlagReason = useCallback(
    async (refId: string, reason: string) => {
      if (!selectedSessionId) return;
      onOptimisticFlagReason?.(refId, reason);
      try {
        const data = await updateGradeFlagReason({
          workspaceId: selectedSessionId,
          refId,
          reason,
        }) as { flags?: Array<GradingFlag> };
        if (!data.flags) return;
        onFlagsUpdate?.(data.flags);
      } catch (err) {
        console.error(err);
      }
    },
    [
      onFlagsUpdate,
      onOptimisticFlagReason,
      selectedSessionId,
      updateGradeFlagReason,
    ],
  );

  const scheduleFlagReasonSave = useCallback((
    refId: string,
    reason: string,
  ) => {
    const timers = flagReasonTimeoutsRef.current;
    if (timers[refId]) {
      clearTimeout(timers[refId]);
    }
    timers[refId] = globalThis.setTimeout(() => {
      updateFlagReason(refId, reason);
      delete timers[refId];
    }, 650);
  }, [updateFlagReason]);

  const runGrader = useCallback(async () => {
    if (!selectedSessionId || !selectedGraderId) return;
    try {
      const data = await runGrade({
        workspaceId: selectedSessionId,
        graderId: selectedGraderId,
        scenarioRunId: selectedTestRunId ?? undefined,
      });
      const returnedRun = data.run;
      const runs = Array.isArray(data.session?.gradingRuns)
        ? data.session!.gradingRuns
        : [];
      const latestRun = (() => {
        if (
          returnedRun?.id &&
          (
            !selectedTestRunId ||
            scenarioRunIdFromCalibrationRun(returnedRun) === selectedTestRunId
          )
        ) {
          return returnedRun;
        }
        if (!runs.length) return null;
        if (!selectedTestRunId) {
          return returnedRun ?? runs[runs.length - 1] ?? null;
        }
        for (let i = runs.length - 1; i >= 0; i -= 1) {
          const candidate = runs[i];
          if (
            scenarioRunIdFromCalibrationRun(candidate) === selectedTestRunId
          ) {
            return candidate;
          }
        }
        return null;
      })();
      if (latestRun?.id) {
        setExpandedRunId(latestRun.id);
        setRouteGradeRunId(latestRun.id);
        setOptimisticRunId(latestRun.id);
        workspaceRouting.setGradeRunId(latestRun.id);
        updateCalibratePath(selectedSessionId, { gradeRunId: latestRun.id });
      } else {
        setExpandedRunId(null);
        setRouteGradeRunId(null);
        setOptimisticRunId(null);
        workspaceRouting.setGradeRunId(null);
        updateCalibratePath(selectedSessionId, { gradeRunId: null });
      }
    } catch (err) {
      console.error(err);
    }
  }, [
    runGrade,
    selectedGraderId,
    selectedSessionId,
    selectedTestRunId,
    updateCalibratePath,
    workspaceRouting,
  ]);

  const canRun = Boolean(selectedSessionId && selectedGraderId && !running);

  const handleTestRunSelection = useCallback((nextRunId: string) => {
    if (!nextRunId) return;
    if (nextRunId === selectedTestRunId) return;
    setExpandedRunId(null);
    setRouteGradeRunId(null);
    setOptimisticRunId(null);
    workspaceRouting.setGradeRunId(null);
    workspaceRouting.setTestRunId(nextRunId);
    setSelectedTestRunId(nextRunId);
    updateCalibratePath(selectedSessionId, { gradeRunId: null });
  }, [
    selectedSessionId,
    selectedTestRunId,
    updateCalibratePath,
    workspaceRouting,
  ]);

  const testRunListOptions = useMemo(
    () =>
      testRunOptions.map((entry) => ({
        value: entry.scenarioRunId,
        label: getScenarioTitle(entry),
        meta: [
          entry.updatedAt,
          entry.scenarioRunId,
        ].filter(Boolean).join(" · "),
      })),
    [testRunOptions],
  );

  const graderOptions = useMemo(
    () =>
      graders.map((grader) => ({
        id: grader.id,
        label: grader.label,
        meta: botFilename(grader.path ?? null) ?? undefined,
        description: grader.description,
      })),
    [graders],
  );

  const onToggleRunSection = useCallback((runId: string) => {
    setExpandedRunId((prev) => {
      const next = prev === runId ? null : runId;
      updateCalibratePath(selectedSessionId, {
        gradeRunId: next,
      });
      setRouteGradeRunId(next);
      workspaceRouting.setGradeRunId(next);
      return next;
    });
  }, [selectedSessionId, updateCalibratePath, workspaceRouting]);

  const missingRunHref = selectedSessionId
    ? buildGradePath(selectedSessionId)
    : undefined;

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(null);
    return () => setNavActions(null);
  }, [setNavActions]);

  return (
    <GradeTabShell
      runner={
        <GradeRunnerPanel
          testRunOptions={testRunListOptions}
          selectedTestRunId={selectedTestRunId}
          onSelectTestRun={handleTestRunSelection}
          graders={graderOptions}
          selectedGraderId={selectedGraderId}
          onSelectGrader={setSelectedGraderId}
          selectedGraderDescription={selectedGrader?.description}
          sessionsCount={sessions.length}
          onRunGrader={runGrader}
          canRun={canRun}
          running={running}
        />
      }
      results={
        <GradeResultsPanel
          error={error ?? null}
          loading={loading}
          runCount={filteredSessionRuns.length}
          runItemsCount={runItems.length}
          emptyMessage={selectedTestRunId
            ? "No grader runs for this selected test run yet."
            : "No grader runs for this session yet."}
          routeRunNotFound={routeRunNotFound}
          missingRunHref={missingRunHref}
          runSections={runSections}
          expandedRunId={expandedRunId}
          onToggleRun={onToggleRunSection}
          expandedResults={expandedResults}
          onToggleExpandedResult={(itemKey) =>
            setExpandedResults((prev) => ({
              ...prev,
              [itemKey]: !prev[itemKey],
            }))}
          flaggedRefSet={flaggedRefSet}
          flagReasonDrafts={flagReasonDrafts}
          flagReasonByRefId={gradingFlagByRefId}
          onToggleFlag={toggleFlag}
          onFlagReasonChange={(refId, reason) => {
            setFlagReasonDrafts((prev) => ({
              ...prev,
              [refId]: reason,
            }));
            scheduleFlagReasonSave(refId, reason);
          }}
          onFlagReasonBlur={(refId, reason) =>
            scheduleFlagReasonSave(refId, reason)}
          onAddErrorToWorkbench={onAddErrorToWorkbench
            ? ({ runId, error }) =>
              onAddErrorToWorkbench({
                source: "grader_run_error",
                workspaceId: selectedSessionId ?? activeWorkspaceId ??
                  undefined,
                runId,
                error,
              })
            : undefined}
          topErrorRunId={routeGradeRunId ?? expandedRunId}
        />
      }
    />
  );
}

export default GradePage;
