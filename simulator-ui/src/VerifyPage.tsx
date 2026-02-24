import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Button from "./gds/Button.tsx";
import Badge from "./gds/Badge.tsx";
import Listbox from "./gds/Listbox.tsx";
import Callout from "./gds/Callout.tsx";
import PageGrid from "./gds/PageGrid.tsx";
import PageShell from "./gds/PageShell.tsx";
import Panel from "./gds/Panel.tsx";
import {
  botFilename,
  buildGradePath,
  buildVerifyPath,
  classNames,
  formatTimestampShort,
  scenarioNameFromValue,
} from "./utils.ts";
import type { CalibrationRun, GraderDeckMeta } from "./utils.ts";
import { useWorkspaceGrade, useWorkspaceRouting } from "./WorkspaceContext.tsx";
import {
  buildVerifyConsistencyReport,
  VERIFY_CONSISTENCY_THRESHOLDS,
} from "./verify_metrics.ts";
import type { WorkbenchComposerChip } from "./Chat.tsx";

const MAX_BATCH_SIZE = 24;
const MAX_BATCH_CONCURRENCY = 6;
const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_BATCH_CONCURRENCY = 3;
const NO_SCENARIO_RUN_VALUE = "__workspace_context__";

type ScenarioRunSummary = {
  scenarioRunId: string;
  lastEventSeq?: number;
  updatedAt?: string;
  selectedScenarioDeckId?: string;
  selectedScenarioDeckLabel?: string;
  scenarioConfigPath?: string;
};

type VerifyBatchRequest = {
  requestId: string;
  status: "queued" | "running" | "completed" | "error";
  runId?: string;
  error?: string;
};

type VerifyBatchState = {
  batchId: number;
  status: "idle" | "running" | "completed" | "error";
  startedAt?: string;
  finishedAt?: string;
  requested: number;
  concurrency: number;
  completed: number;
  failed: number;
  active: number;
  initialRunIds: string[];
  requests: VerifyBatchRequest[];
};

type VerifyRunSampleResponse = {
  run: CalibrationRun;
  error?: string;
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

const parseRunAt = (run: CalibrationRun): number => {
  const parsed = Date.parse(run.runAt ?? "");
  return Number.isFinite(parsed) ? parsed : -1;
};

const clampInt = (value: number, min: number, max: number): number => {
  const rounded = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, rounded));
};

const formatSignedScore = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value}`;
};

const scoreBadgeVariant = (
  value: number | null | undefined,
): "ghost" | "error" | "completed" | "idle" => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "ghost";
  if (value < 0) return "error";
  if (value > 0) return "completed";
  return "idle";
};

function VerifyPage(
  {
    setNavActions,
    onAppPathChange,
    activeWorkspaceId,
    composerChips,
    onComposerChipsChange,
  }: {
    setNavActions?: (actions: React.ReactNode | null) => void;
    onAppPathChange?: (path: string) => void;
    activeWorkspaceId?: string | null;
    composerChips?: WorkbenchComposerChip[];
    onComposerChipsChange?: (next: WorkbenchComposerChip[]) => void;
  },
) {
  const {
    loading,
    error,
    graders,
    sessions,
    sessionDetail,
    loadData,
    loadSessionDetail,
  } = useWorkspaceGrade();
  const workspaceRouting = useWorkspaceRouting();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    activeWorkspaceId ?? null,
  );
  const [selectedGraderId, setSelectedGraderId] = useState<string | null>(null);
  const [selectedScenarioRunId, setSelectedScenarioRunId] = useState<
    string | null
  >(null);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [batchConcurrency, setBatchConcurrency] = useState(
    DEFAULT_BATCH_CONCURRENCY,
  );
  const [batchState, setBatchState] = useState<VerifyBatchState>({
    batchId: 0,
    status: "idle",
    requested: 0,
    concurrency: 0,
    completed: 0,
    failed: 0,
    active: 0,
    initialRunIds: [],
    requests: [],
  });
  const batchSeqRef = useRef(0);

  const updateVerifyPath = useCallback((sessionId: string | null) => {
    const targetPath = buildVerifyPath(sessionId);
    if (window.location.pathname === targetPath) return;
    window.history.replaceState({}, "", targetPath);
    onAppPathChange?.(targetPath);
  }, [onAppPathChange]);

  const navigateToAppPath = useCallback((nextPath: string) => {
    if (window.location.pathname === nextPath) return;
    window.history.pushState({}, "", nextPath);
    onAppPathChange?.(nextPath);
  }, [onAppPathChange]);

  const handleInternalLinkClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }
      event.preventDefault();
      navigateToAppPath(href);
    },
    [navigateToAppPath],
  );

  const loadVerifyData = useCallback(async () => {
    await loadData({ workspaceId: activeWorkspaceId ?? null });
  }, [activeWorkspaceId, loadData]);

  useEffect(() => {
    loadVerifyData();
  }, [loadVerifyData]);

  useEffect(() => {
    setSelectedSessionId((prev) => {
      if (activeWorkspaceId) return activeWorkspaceId;
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

  useEffect(() => {
    if (!selectedSessionId) return;
    updateVerifyPath(selectedSessionId);
  }, [selectedSessionId, updateVerifyPath]);

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

  const scenarioRunOptions = useMemo(() => {
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
          scenarioRunOptions.some((entry) => entry.scenarioRunId === runId),
      );
    const meta = sessionDetail?.meta && typeof sessionDetail.meta === "object"
      ? sessionDetail.meta as Record<string, unknown>
      : {};
    const currentScenarioRunId = typeof meta.scenarioRunId === "string" &&
        meta.scenarioRunId.trim().length > 0
      ? meta.scenarioRunId
      : null;
    const nextRunId = hasOption(workspaceRouting.testRunId)
      ? workspaceRouting.testRunId
      : hasOption(selectedScenarioRunId)
      ? selectedScenarioRunId
      : hasOption(currentScenarioRunId)
      ? currentScenarioRunId
      : scenarioRunOptions[0]?.scenarioRunId ?? null;
    if (selectedScenarioRunId !== nextRunId) {
      setSelectedScenarioRunId(nextRunId);
    }
    if (workspaceRouting.testRunId !== nextRunId) {
      workspaceRouting.setTestRunId(nextRunId);
    }
  }, [
    scenarioRunOptions,
    selectedScenarioRunId,
    sessionDetail?.meta,
    workspaceRouting,
  ]);

  const sessionRuns = useMemo(() => {
    if (!selectedSession?.gradingRuns) return [];
    return [...selectedSession.gradingRuns].sort((a, b) =>
      parseRunAt(b) - parseRunAt(a)
    );
  }, [selectedSession?.gradingRuns]);

  const filteredRuns = useMemo(() => {
    return sessionRuns.filter((run) => {
      if (selectedGraderId && run.graderId !== selectedGraderId) return false;
      if (!selectedScenarioRunId) return true;
      return scenarioRunIdFromCalibrationRun(run) === selectedScenarioRunId;
    });
  }, [selectedGraderId, selectedScenarioRunId, sessionRuns]);

  const runConsistencySample = useCallback(async (payload: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: string;
  }): Promise<VerifyRunSampleResponse> => {
    const res = await fetch("/api/calibrate/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({})) as {
      error?: string;
      run?: CalibrationRun;
    };
    if (!res.ok) {
      throw new Error(body.error ?? res.statusText);
    }
    if (!body.run) {
      throw new Error(
        body.error ?? "Calibration run response missing run payload",
      );
    }
    return { run: body.run, error: body.error };
  }, []);

  const updateBatchRequest = useCallback((
    batchId: number,
    index: number,
    patch: Partial<VerifyBatchRequest>,
  ) => {
    setBatchState((prev) => {
      if (prev.batchId !== batchId) return prev;
      if (index < 0 || index >= prev.requests.length) return prev;
      const nextRequests = prev.requests.map((request, requestIndex) =>
        requestIndex === index ? { ...request, ...patch } : request
      );
      const completed = nextRequests.filter((request) =>
        request.status === "completed"
      ).length;
      const failed = nextRequests.filter((request) =>
        request.status === "error"
      )
        .length;
      const active =
        nextRequests.filter((request) => request.status === "running").length;
      const terminal = completed + failed === prev.requested && active === 0;
      const nextStatus = terminal
        ? failed > 0 ? "error" : "completed"
        : "running";
      return {
        ...prev,
        requests: nextRequests,
        completed,
        failed,
        active,
        status: nextStatus,
        finishedAt: terminal ? new Date().toISOString() : prev.finishedAt,
      };
    });
  }, []);

  const runConsistencyBatch = useCallback(async () => {
    if (!selectedSessionId || !selectedGraderId) return;
    const nextBatchSize = clampInt(batchSize, 1, MAX_BATCH_SIZE);
    const nextConcurrency = clampInt(
      batchConcurrency,
      1,
      Math.min(MAX_BATCH_CONCURRENCY, nextBatchSize),
    );
    const batchId = batchSeqRef.current + 1;
    batchSeqRef.current = batchId;
    const now = new Date().toISOString();
    const initialRunIds = filteredRuns.map((run) => run.id);
    const initialRequests: VerifyBatchRequest[] = Array.from(
      { length: nextBatchSize },
      (_, index) => ({
        requestId: `${batchId}:${index + 1}`,
        status: "queued",
      }),
    );
    setBatchState({
      batchId,
      status: "running",
      startedAt: now,
      finishedAt: undefined,
      requested: nextBatchSize,
      concurrency: nextConcurrency,
      completed: 0,
      failed: 0,
      active: 0,
      initialRunIds,
      requests: initialRequests,
    });

    let cursor = 0;
    const workers = Array.from({ length: nextConcurrency }, () =>
      (async () => {
        while (true) {
          const nextIndex = cursor;
          cursor += 1;
          if (nextIndex >= nextBatchSize) return;
          if (batchSeqRef.current !== batchId) return;
          updateBatchRequest(batchId, nextIndex, { status: "running" });
          try {
            const response = await runConsistencySample({
              workspaceId: selectedSessionId,
              graderId: selectedGraderId,
              scenarioRunId: selectedScenarioRunId ?? undefined,
            });
            if (batchSeqRef.current !== batchId) return;
            if (response.run.status !== "completed") {
              updateBatchRequest(batchId, nextIndex, {
                status: "error",
                runId: response.run.id,
                error: response.run.error ??
                  `Calibration run ended with status ${response.run.status}`,
              });
              continue;
            }
            updateBatchRequest(batchId, nextIndex, {
              status: "completed",
              runId: response.run.id,
            });
          } catch (err) {
            if (batchSeqRef.current !== batchId) return;
            updateBatchRequest(batchId, nextIndex, {
              status: "error",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      })());

    await Promise.all(workers);
    if (batchSeqRef.current !== batchId) return;
    await loadData({ workspaceId: selectedSessionId }).catch(() => {});
  }, [
    batchConcurrency,
    batchSize,
    filteredRuns,
    loadData,
    runConsistencySample,
    selectedGraderId,
    selectedScenarioRunId,
    selectedSessionId,
    updateBatchRequest,
  ]);

  const batchInitialRunIdSet = useMemo(
    () => new Set(batchState.initialRunIds),
    [batchState.initialRunIds],
  );

  const activeBatchRuns = useMemo(() => {
    if (!batchState.startedAt) return [];
    const startedAt = Date.parse(batchState.startedAt);
    const hasStartedAt = Number.isFinite(startedAt);
    return filteredRuns.filter((run) => {
      if (batchInitialRunIdSet.has(run.id)) return false;
      if (!hasStartedAt) return true;
      const runAt = parseRunAt(run);
      return runAt < 0 || runAt >= startedAt - 2000;
    });
  }, [batchInitialRunIdSet, batchState.startedAt, filteredRuns]);

  const completedBatchRuns = useMemo(
    () => activeBatchRuns.filter((run) => run.status === "completed"),
    [activeBatchRuns],
  );

  const historicalCompletedRuns = useMemo(
    () => filteredRuns.filter((run) => run.status === "completed"),
    [filteredRuns],
  );

  const reportRuns = useMemo(
    () =>
      completedBatchRuns.length > 0
        ? completedBatchRuns
        : historicalCompletedRuns,
    [completedBatchRuns, historicalCompletedRuns],
  );

  const consistencyReport = useMemo(
    () => buildVerifyConsistencyReport(reportRuns),
    [reportRuns],
  );

  const queuedCount = useMemo(
    () =>
      batchState.requests.filter((request) => request.status === "queued")
        .length,
    [batchState.requests],
  );

  const canRun = Boolean(
    selectedSessionId &&
      selectedGraderId &&
      batchState.status !== "running",
  );

  const topOutliers = consistencyReport.outliers.slice(0, 8);
  const resolvedComposerChips = useMemo(
    () => composerChips ?? [],
    [composerChips],
  );
  const composerChipIds = useMemo(
    () => new Set(resolvedComposerChips.map((chip) => chip.chipId)),
    [resolvedComposerChips],
  );

  const mergeComposerChip = useCallback(
    (base: WorkbenchComposerChip[], chip: WorkbenchComposerChip) => {
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
    onComposerChipsChange(mergeComposerChip(resolvedComposerChips, chip));
  }, [mergeComposerChip, onComposerChipsChange, resolvedComposerChips]);

  const removeComposerChip = useCallback((chipId: string) => {
    if (!onComposerChipsChange) return;
    onComposerChipsChange(
      resolvedComposerChips.filter((chip) => chip.chipId !== chipId),
    );
  }, [onComposerChipsChange, resolvedComposerChips]);

  const buildOutlierChip = useCallback(
    (outlier: typeof topOutliers[number]) => {
      const chipId = `verify:${selectedSessionId ?? ""}:${outlier.key}`;
      const runId = outlier.maxRunId ?? outlier.minRunId;
      const score = outlier.maxScore ?? outlier.minScore ?? undefined;
      const agreementText = outlier.agreementRate === null
        ? "agreement unavailable"
        : `agreement ${Math.round(outlier.agreementRate * 100)}%`;
      const deltaText = outlier.scoreDelta === null
        ? "delta unavailable"
        : `delta ${outlier.scoreDelta}`;
      return {
        chipId,
        source: "verify_outlier" as const,
        workspaceId: selectedSessionId ?? undefined,
        runId,
        capturedAt: new Date().toISOString(),
        outlierKey: outlier.key,
        instability: outlier.instability,
        score,
        message:
          `Verify outlier ${outlier.label}: ${agreementText}, ${deltaText}, samples ${outlier.sampleSize}`,
        enabled: true,
      };
    },
    [selectedSessionId],
  );

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(null);
    return () => setNavActions(null);
  }, [setNavActions]);

  useEffect(() => {
    return () => {
      batchSeqRef.current += 1;
    };
  }, []);

  return (
    <PageShell className="verify-shell">
      <PageGrid as="main" className="verify-layout">
        <Panel className="verify-controls">
          <div className="verify-controls-header">
            <strong>Verify consistency</strong>
            <span className="secondary-note">
              Run repeated grading checks against one grader and scenario.
            </span>
          </div>
          {scenarioRunOptions.length > 0 && (
            <Listbox
              label="Scenario run"
              value={selectedScenarioRunId ?? NO_SCENARIO_RUN_VALUE}
              onChange={(runId) => {
                if (runId === NO_SCENARIO_RUN_VALUE) {
                  setSelectedScenarioRunId(null);
                  workspaceRouting.setTestRunId(null);
                  return;
                }
                setSelectedScenarioRunId(runId);
                workspaceRouting.setTestRunId(runId);
              }}
              options={[
                {
                  value: NO_SCENARIO_RUN_VALUE,
                  label: "Current workspace context",
                  meta: "Run without a prior scenario run binding",
                },
                ...scenarioRunOptions.map((entry) => ({
                  value: entry.scenarioRunId,
                  label: getScenarioTitle(entry),
                  meta: [
                    entry.updatedAt
                      ? formatTimestampShort(entry.updatedAt)
                      : null,
                    entry.scenarioRunId,
                  ].filter(Boolean).join(" · "),
                })),
              ]}
              placeholder="Select scenario run"
            />
          )}
          <Listbox
            label="Grader"
            value={selectedGraderId ?? ""}
            onChange={(value) =>
              setSelectedGraderId(value.length ? value : null)}
            options={graders.map((grader: GraderDeckMeta) => ({
              value: grader.id,
              label: grader.label,
              meta: botFilename(grader.path ?? null) ?? undefined,
            }))}
            placeholder="Select grader"
            disabled={graders.length === 0}
          />
          <div className="verify-number-grid">
            <label className="verify-number-field">
              Batch size
              <input
                type="number"
                min={1}
                max={MAX_BATCH_SIZE}
                value={batchSize}
                onChange={(event) =>
                  setBatchSize(
                    clampInt(Number(event.target.value), 1, MAX_BATCH_SIZE),
                  )}
              />
            </label>
            <label className="verify-number-field">
              Concurrency
              <input
                type="number"
                min={1}
                max={MAX_BATCH_CONCURRENCY}
                value={batchConcurrency}
                onChange={(event) =>
                  setBatchConcurrency(
                    clampInt(
                      Number(event.target.value),
                      1,
                      MAX_BATCH_CONCURRENCY,
                    ),
                  )}
              />
            </label>
          </div>
          <Button
            variant="primary"
            onClick={runConsistencyBatch}
            disabled={!canRun}
          >
            {batchState.status === "running"
              ? "Running consistency batch…"
              : "Run consistency batch"}
          </Button>
          <Callout variant="emphasis" title="Build assistant stays available">
            Use the chat drawer toggle in the top-right corner to investigate
            and iterate while this page remains open.
          </Callout>
          {sessions.length === 0 && (
            <Callout>
              No workspaces found yet. Run a Test scenario first so Verify has
              evidence to grade.
            </Callout>
          )}
          {graders.length === 0 && (
            <Callout>
              No graders are available. Add <code>[[graders]]</code>{" "}
              entries to the active root deck.
            </Callout>
          )}
          {selectedGrader?.description && (
            <Callout>{selectedGrader.description}</Callout>
          )}
        </Panel>
        <Panel className="verify-results">
          {error && <div className="error">{error}</div>}
          {loading && <div className="editor-status">Loading verify data…</div>}
          {!loading && (
            <>
              <div className="verify-status-row">
                <div className="verify-status-main">
                  <strong>Batch status</strong>
                  <div className="verify-status-meta">
                    <Badge status={batchState.status}>
                      {batchState.status}
                    </Badge>
                    {batchState.startedAt
                      ? ` · started ${
                        formatTimestampShort(batchState.startedAt)
                      }`
                      : ""}
                    {batchState.finishedAt
                      ? ` · finished ${
                        formatTimestampShort(batchState.finishedAt)
                      }`
                      : ""}
                  </div>
                </div>
                {consistencyReport.sampleSize > 0 && (
                  <span
                    className={classNames(
                      "verify-verdict-badge",
                      `verify-verdict-badge--${consistencyReport.verdict.toLowerCase()}`,
                    )}
                  >
                    {consistencyReport.verdict}
                  </span>
                )}
              </div>
              {batchState.requested > 0 && (
                <div className="verify-progress-row">
                  <span>Queued: {queuedCount}</span>
                  <span>Running: {batchState.active}</span>
                  <span>Completed: {batchState.completed}</span>
                  <span>Failed: {batchState.failed}</span>
                </div>
              )}
              {batchState.status === "idle" &&
                consistencyReport.sampleSize === 0 && (
                <Callout>
                  Run a consistency batch to compute agreement, spread, and
                  instability for the selected grader.
                </Callout>
              )}
              {consistencyReport.sampleSize > 0 && (
                <>
                  <div className="verify-metric-grid">
                    <div className="verify-metric-card">
                      <div className="verify-metric-label">Sample size</div>
                      <div className="verify-metric-value">
                        {consistencyReport.sampleSize}
                      </div>
                    </div>
                    <div className="verify-metric-card">
                      <div className="verify-metric-label">Agreement rate</div>
                      <div className="verify-metric-value">
                        {consistencyReport.agreementRate === null
                          ? "—"
                          : `${
                            Math.round(consistencyReport.agreementRate * 100)
                          }%`}
                      </div>
                    </div>
                    <div className="verify-metric-card">
                      <div className="verify-metric-label">
                        Score spread (min/median/max)
                      </div>
                      <div className="verify-metric-value verify-metric-value--compact">
                        {consistencyReport.scoreSpreadMin === null
                          ? "—"
                          : `${consistencyReport.scoreSpreadMin} / ${
                            consistencyReport.scoreSpreadMedian ?? "—"
                          } / ${consistencyReport.scoreSpreadMax ?? "—"}`}
                      </div>
                    </div>
                    <div className="verify-metric-card">
                      <div className="verify-metric-label">
                        Instability count
                      </div>
                      <div className="verify-metric-value">
                        {consistencyReport.instabilityCount}
                      </div>
                    </div>
                  </div>
                  <Callout
                    variant={consistencyReport.verdict === "FAIL"
                      ? "danger"
                      : consistencyReport.verdict === "WARN"
                      ? "emphasis"
                      : "muted"}
                    title={`Verdict: ${consistencyReport.verdict}`}
                  >
                    {consistencyReport.verdictReason}
                  </Callout>
                </>
              )}
              <Callout title="Thresholds in code">
                Min sample size: {VERIFY_CONSISTENCY_THRESHOLDS.minSampleSize}
                {" "}
                · PASS requires agreement ≥ {Math.round(
                  VERIFY_CONSISTENCY_THRESHOLDS.pass.agreementMin * 100,
                )}
                %, spread ≤{" "}
                {VERIFY_CONSISTENCY_THRESHOLDS.pass.maxSpread}, instability ≤
                {" "}
                {VERIFY_CONSISTENCY_THRESHOLDS.pass.maxInstabilityCount}{" "}
                · WARN allows agreement ≥ {Math.round(
                  VERIFY_CONSISTENCY_THRESHOLDS.warn.agreementMin * 100,
                )}
                %, spread ≤{" "}
                {VERIFY_CONSISTENCY_THRESHOLDS.warn.maxSpread}, instability ≤
                {" "}
                {VERIFY_CONSISTENCY_THRESHOLDS.warn.maxInstabilityCount}.
              </Callout>
              <div className="verify-section">
                <strong>Most inconsistent examples</strong>
                {topOutliers.length === 0
                  ? (
                    <Callout>
                      Inconsistent examples will appear here as soon as at least
                      one completed run is available in this batch.
                    </Callout>
                  )
                  : (
                    <div className="verify-outlier-list">
                      {topOutliers.map((outlier) => {
                        const runLinks = (() => {
                          if (!selectedSessionId) return [];
                          const ids = [
                            outlier.maxRunId,
                            outlier.minRunId,
                          ].filter((value): value is string => Boolean(value));
                          return [...new Set(ids)];
                        })();
                        return (
                          <div
                            key={outlier.key}
                            className="verify-outlier-card"
                          >
                            <div className="verify-outlier-header">
                              <strong>{outlier.label}</strong>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                {outlier.minScore === outlier.maxScore
                                  ? (
                                    <Badge
                                      variant={scoreBadgeVariant(
                                        outlier.minScore,
                                      )}
                                    >
                                      {formatSignedScore(outlier.minScore)}
                                    </Badge>
                                  )
                                  : (
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                      }}
                                    >
                                      <Badge
                                        variant={scoreBadgeVariant(
                                          outlier.minScore,
                                        )}
                                        style={{
                                          borderTopRightRadius: 0,
                                          borderBottomRightRadius: 0,
                                        }}
                                      >
                                        {formatSignedScore(outlier.minScore)}
                                      </Badge>
                                      <Badge
                                        variant={scoreBadgeVariant(
                                          outlier.maxScore,
                                        )}
                                        style={{
                                          marginLeft: "-1px",
                                          borderTopLeftRadius: 0,
                                          borderBottomLeftRadius: 0,
                                        }}
                                      >
                                        {formatSignedScore(outlier.maxScore)}
                                      </Badge>
                                    </div>
                                  )}
                                <Badge
                                  variant={outlier.instability
                                    ? "error"
                                    : "completed"}
                                >
                                  {outlier.instability ? "Unstable" : "Stable"}
                                </Badge>
                              </div>
                            </div>
                            <div className="verify-outlier-meta">
                              agreement {outlier.agreementRate === null
                                ? "—"
                                : `${Math.round(outlier.agreementRate * 100)}%`}
                              {" "}
                              · delta {outlier.scoreDelta ?? "—"} · samples{" "}
                              {outlier.sampleSize}
                              {outlier.passFlip ? " · pass/fail flip" : ""}
                              {outlier.messageRefId
                                ? ` · ref ${outlier.messageRefId}`
                                : ""}
                            </div>
                            {(() => {
                              const outlierChip = buildOutlierChip(outlier);
                              const inChat = composerChipIds.has(
                                outlierChip.chipId,
                              );
                              return (
                                <div className="workbench-summary-actions">
                                  <Button
                                    variant="secondary"
                                    size="small"
                                    onClick={() =>
                                      inChat
                                        ? removeComposerChip(
                                          outlierChip.chipId,
                                        )
                                        : addComposerChip(outlierChip)}
                                    disabled={!onComposerChipsChange}
                                  >
                                    {inChat
                                      ? "Remove from chat"
                                      : "Add to chat"}
                                  </Button>
                                </div>
                              );
                            })()}
                            {runLinks.length > 0 && (
                              <div className="verify-outlier-links">
                                {runLinks.map((runId) => {
                                  if (!selectedSessionId) return null;
                                  const href = buildGradePath(
                                    selectedSessionId,
                                    runId,
                                  );
                                  return (
                                    <a
                                      key={runId}
                                      href={href}
                                      onClick={(event) =>
                                        handleInternalLinkClick(event, href)}
                                    >
                                      Open grade run {runId}
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>
              {batchState.requests.length > 0 && (
                <div className="verify-section">
                  <strong>Batch requests</strong>
                  <ul className="verify-request-list">
                    {batchState.requests.map((request, index) => (
                      <li
                        key={request.requestId}
                        className="verify-request-row"
                      >
                        <span className="verify-request-index">
                          #{index + 1}
                        </span>
                        <Badge
                          status={request.status === "queued"
                            ? "idle"
                            : request.status}
                        >
                          {request.status}
                        </Badge>
                        {selectedSessionId && request.runId
                          ? (() => {
                            const href = buildGradePath(
                              selectedSessionId,
                              request.runId,
                            );
                            return (
                              <a
                                href={href}
                                onClick={(event) =>
                                  handleInternalLinkClick(event, href)}
                              >
                                {request.runId}
                              </a>
                            );
                          })()
                          : request.runId
                          ? <code>{request.runId}</code>
                          : null}
                        {request.error && (
                          <span className="verify-request-error">
                            {request.error}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Panel>
      </PageGrid>
    </PageShell>
  );
}

export default VerifyPage;
