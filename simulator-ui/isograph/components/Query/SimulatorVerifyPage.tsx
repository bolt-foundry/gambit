import { iso } from "@iso-gambit-sim";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildWorkspacePath } from "../../../../src/workspace_routes.ts";
import gambitWorkspaceVerifyBatchRunCreateMutation from "../../../mutations/GambitWorkspaceVerifyBatchRunCreateMutation.ts";
import gambitWorkspaceVerifyLiveSubscription from "../../../subscriptions/GambitWorkspaceVerifyLiveSubscription.ts";
import { useGambitTypedMutation } from "../../../src/hooks/useGambitTypedMutation.tsx";
import { useGambitTypedSubscription } from "../../../src/hooks/useGambitTypedSubscription.tsx";
import { useRouter } from "../../../src/RouterContext.tsx";
import Badge from "../../../src/gds/Badge.tsx";
import Button from "../../../src/gds/Button.tsx";
import Callout from "../../../src/gds/Callout.tsx";
import Listbox from "../../../src/gds/Listbox.tsx";
import PageGrid from "../../../src/gds/PageGrid.tsx";
import PageShell from "../../../src/gds/PageShell.tsx";
import Panel from "../../../src/gds/Panel.tsx";
import {
  classNames,
  formatTimestampShort,
  scenarioNameFromValue,
} from "../../../src/utils.ts";
import { VERIFY_CONSISTENCY_THRESHOLDS } from "../../../src/verify_metrics.ts";

const MAX_BATCH_SIZE = 24;
const MAX_BATCH_CONCURRENCY = 6;
const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_BATCH_CONCURRENCY = 3;
const NO_SCENARIO_RUN_VALUE = "__workspace_context__";

type VerifyBatchStatus = "idle" | "running" | "completed" | "error";
type VerifyBatchRequestStatus =
  | "queued"
  | "running"
  | "completed"
  | "error";

type VerifyOutlierView = {
  key: string;
  label: string;
  sampleSize: number;
  agreementRate: number | null;
  scoreDelta: number | null;
  passFlip: boolean;
  instability: boolean;
  minRunId?: string;
  maxRunId?: string;
  turnIndex?: number;
  messageRefId?: string;
};

type VerifyMetricsView = {
  sampleSize: number;
  agreementRate: number | null;
  scoreSpreadMin: number | null;
  scoreSpreadMedian: number | null;
  scoreSpreadMax: number | null;
  instabilityCount: number;
  verdict: "PASS" | "WARN" | "FAIL";
  verdictReason: string;
  outliers: Array<VerifyOutlierView>;
};

type VerifyBatchView = {
  id: string;
  graderId: string;
  scenarioRunId: string | null;
  status: VerifyBatchStatus;
  startedAt: string | null;
  finishedAt: string | null;
  requested: number;
  active: number;
  completed: number;
  failed: number;
  requests: Array<{
    id: string;
    status: VerifyBatchRequestStatus;
    runId?: string;
    error?: string;
  }>;
  metrics: VerifyMetricsView | null;
};

function getRoutePrefix(path: string): string {
  return path === "/isograph" || path.startsWith("/isograph/")
    ? "/isograph"
    : "";
}

function toBatchStatus(
  status: string | null | undefined,
): VerifyBatchStatus {
  const normalized = (status ?? "").trim().toUpperCase();
  if (normalized === "RUNNING") return "running";
  if (normalized === "COMPLETED") return "completed";
  if (normalized === "ERROR") return "error";
  return "idle";
}

function toBatchRequestStatus(
  status: string | null | undefined,
): VerifyBatchRequestStatus {
  const normalized = (status ?? "").trim().toUpperCase();
  if (normalized === "RUNNING") return "running";
  if (normalized === "COMPLETED") return "completed";
  if (normalized === "ERROR") return "error";
  return "queued";
}

function clampInt(value: number, min: number, max: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, rounded));
}

export const SimulatorVerifyPage = iso(`
  field Workspace.VerifyTab @component {
    id
    scenarioRuns(first: 50) {
      edges {
        node {
          id
          status
          startedAt
          finishedAt
          error
        }
      }
    }
    verification {
      graderDecks(first: 50) {
        edges {
          node {
            id
            label
            description
            path
          }
        }
      }
      batches(first: 50) {
        edges {
          node {
            id
            workspaceId
            graderId
            scenarioRunId
            status
            startedAt
            finishedAt
            requested
            active
            completed
            failed
            requests(first: 50) {
              edges {
                node {
                  id
                  status
                  runId
                  error
                }
              }
            }
            metrics {
              sampleSize
              agreementRate
              scoreSpreadMin
              scoreSpreadMedian
              scoreSpreadMax
              instabilityCount
              verdict
              verdictReason
              outliers(first: 25) {
                edges {
                  node {
                    key
                    label
                    sampleSize
                    agreementRate
                    scoreDelta
                    passFlip
                    instability
                    minRunId
                    maxRunId
                    turnIndex
                    messageRefId
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`)(function SimulatorVerifyPage({ data }) {
  const workspaceId = data.id ?? "";
  const { currentRoutePath, navigate } = useRouter();
  const routePrefix = useMemo(() => getRoutePrefix(currentRoutePath), [
    currentRoutePath,
  ]);
  const toPrefixedPath = useCallback(
    (path: string) => `${routePrefix}${path}`,
    [routePrefix],
  );

  const runBatchMutation = useGambitTypedMutation(
    gambitWorkspaceVerifyBatchRunCreateMutation,
  );

  useGambitTypedSubscription(
    gambitWorkspaceVerifyLiveSubscription,
    workspaceId ? { workspaceId } : null,
  );

  const graders = useMemo(
    () =>
      (data.verification?.graderDecks?.edges ?? []).flatMap((edge) => {
        const grader = edge?.node;
        if (!grader?.id || !grader.label) return [];
        return [{
          id: grader.id,
          label: grader.label,
          description: grader.description ?? null,
          path: grader.path ?? "",
        }];
      }),
    [data.verification?.graderDecks?.edges],
  );

  const scenarioRuns = useMemo(
    () =>
      (data.scenarioRuns?.edges ?? []).flatMap((edge) => {
        const run = edge?.node;
        if (!run?.id) return [];
        return [{
          id: run.id,
          status: toBatchStatus(run.status),
          startedAt: run.startedAt ?? null,
          finishedAt: run.finishedAt ?? null,
          error: run.error ?? null,
        }];
      }).sort((left, right) => {
        const leftKey = left.finishedAt ?? left.startedAt ?? left.id;
        const rightKey = right.finishedAt ?? right.startedAt ?? right.id;
        return rightKey.localeCompare(leftKey);
      }),
    [data.scenarioRuns?.edges],
  );

  const batches = useMemo<Array<VerifyBatchView>>(
    () =>
      (data.verification?.batches?.edges ?? []).flatMap((edge) => {
        const batch = edge?.node;
        if (!batch?.id || !batch.graderId) return [];
        return [{
          id: batch.id,
          graderId: batch.graderId,
          scenarioRunId: batch.scenarioRunId ?? null,
          status: toBatchStatus(batch.status),
          startedAt: batch.startedAt ?? null,
          finishedAt: batch.finishedAt ?? null,
          requested: batch.requested ?? 0,
          active: batch.active ?? 0,
          completed: batch.completed ?? 0,
          failed: batch.failed ?? 0,
          requests: (batch.requests?.edges ?? []).flatMap((requestEdge) => {
            const request = requestEdge?.node;
            if (!request?.id) return [];
            return [{
              id: request.id,
              status: toBatchRequestStatus(request.status),
              runId: request.runId ?? undefined,
              error: request.error ?? undefined,
            }];
          }),
          metrics: batch.metrics
            ? {
              sampleSize: batch.metrics.sampleSize ?? 0,
              agreementRate: typeof batch.metrics.agreementRate === "number"
                ? batch.metrics.agreementRate
                : null,
              scoreSpreadMin: typeof batch.metrics.scoreSpreadMin === "number"
                ? batch.metrics.scoreSpreadMin
                : null,
              scoreSpreadMedian:
                typeof batch.metrics.scoreSpreadMedian === "number"
                  ? batch.metrics.scoreSpreadMedian
                  : null,
              scoreSpreadMax: typeof batch.metrics.scoreSpreadMax === "number"
                ? batch.metrics.scoreSpreadMax
                : null,
              instabilityCount: batch.metrics.instabilityCount ?? 0,
              verdict: batch.metrics.verdict === "PASS" ||
                  batch.metrics.verdict === "WARN" ||
                  batch.metrics.verdict === "FAIL"
                ? batch.metrics.verdict
                : "WARN",
              verdictReason: batch.metrics.verdictReason ??
                "Verify batch completed.",
              outliers: (batch.metrics.outliers?.edges ?? []).flatMap(
                (outlierEdge) => {
                  const outlier = outlierEdge?.node;
                  if (!outlier?.key || !outlier.label) return [];
                  return [{
                    key: outlier.key,
                    label: outlier.label,
                    sampleSize: outlier.sampleSize ?? 0,
                    agreementRate: typeof outlier.agreementRate === "number"
                      ? outlier.agreementRate
                      : null,
                    scoreDelta: typeof outlier.scoreDelta === "number"
                      ? outlier.scoreDelta
                      : null,
                    passFlip: Boolean(outlier.passFlip),
                    instability: Boolean(outlier.instability),
                    minRunId: outlier.minRunId ?? undefined,
                    maxRunId: outlier.maxRunId ?? undefined,
                    turnIndex: typeof outlier.turnIndex === "number"
                      ? outlier.turnIndex
                      : undefined,
                    messageRefId: outlier.messageRefId ?? undefined,
                  }];
                },
              ),
            }
            : null,
        }];
      }),
    [data.verification?.batches?.edges],
  );

  const [selectedScenarioRunId, setSelectedScenarioRunId] = useState<
    string | null
  >(null);
  const [selectedGraderId, setSelectedGraderId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [batchConcurrency, setBatchConcurrency] = useState(
    DEFAULT_BATCH_CONCURRENCY,
  );
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (
      selectedGraderId &&
      graders.some((grader) => grader.id === selectedGraderId)
    ) {
      return;
    }
    setSelectedGraderId(graders[0]?.id ?? null);
  }, [graders, selectedGraderId]);

  useEffect(() => {
    if (
      selectedScenarioRunId &&
      scenarioRuns.some((scenarioRun) =>
        scenarioRun.id === selectedScenarioRunId
      )
    ) {
      return;
    }
    setSelectedScenarioRunId(scenarioRuns[0]?.id ?? null);
  }, [scenarioRuns, selectedScenarioRunId]);

  const filteredBatches = useMemo(() => {
    return batches.filter((batch) => {
      if (selectedGraderId && batch.graderId !== selectedGraderId) return false;
      if (
        selectedScenarioRunId && batch.scenarioRunId !== selectedScenarioRunId
      ) {
        return false;
      }
      return true;
    });
  }, [batches, selectedGraderId, selectedScenarioRunId]);

  const visibleBatches = filteredBatches.length > 0 ? filteredBatches : batches;

  useEffect(() => {
    if (
      selectedBatchId &&
      visibleBatches.some((batch) => batch.id === selectedBatchId)
    ) {
      return;
    }
    setSelectedBatchId(visibleBatches[0]?.id ?? null);
  }, [selectedBatchId, visibleBatches]);

  const selectedBatch = useMemo(() => {
    if (selectedBatchId) {
      const selected = visibleBatches.find((batch) =>
        batch.id === selectedBatchId
      );
      if (selected) return selected;
    }
    return visibleBatches[0] ?? null;
  }, [selectedBatchId, visibleBatches]);

  const selectedGrader = useMemo(
    () => graders.find((grader) => grader.id === selectedGraderId) ?? null,
    [graders, selectedGraderId],
  );

  const queuedCount = useMemo(
    () =>
      (selectedBatch?.requests ?? []).filter((request) =>
        request.status === "queued"
      )
        .length,
    [selectedBatch?.requests],
  );

  const metrics = selectedBatch?.metrics ?? null;
  const topOutliers = (metrics?.outliers ?? []).slice(0, 8);

  const hasRunningBatch = visibleBatches.some((batch) =>
    batch.status === "running"
  );
  const canRun = Boolean(
    workspaceId && selectedGraderId && !runBatchMutation.inFlight &&
      !hasRunningBatch,
  );

  const runBatch = useCallback(() => {
    if (!workspaceId || !selectedGraderId) return;
    setMutationError(null);
    const nextBatchSize = clampInt(batchSize, 1, MAX_BATCH_SIZE);
    const nextConcurrency = clampInt(
      batchConcurrency,
      1,
      Math.min(MAX_BATCH_CONCURRENCY, nextBatchSize),
    );
    runBatchMutation.commit(
      {
        input: {
          workspaceId,
          graderId: selectedGraderId,
          ...(selectedScenarioRunId
            ? { scenarioRunId: selectedScenarioRunId }
            : {}),
          batchSize: nextBatchSize,
          concurrency: nextConcurrency,
        },
      },
      {
        onComplete: (result) => {
          const nextBatchId = (result as { batch?: { id?: string | null } })
            ?.batch?.id ?? null;
          if (nextBatchId) {
            setSelectedBatchId(nextBatchId);
          }
        },
        onError: () => {
          setMutationError("Failed to run verify batch.");
        },
      },
    );
  }, [
    batchConcurrency,
    batchSize,
    runBatchMutation,
    selectedGraderId,
    selectedScenarioRunId,
    workspaceId,
  ]);

  const navigateToGradeRun = useCallback((runId: string) => {
    const gradePath = buildWorkspacePath("grade", workspaceId, { runId });
    navigate(toPrefixedPath(gradePath));
  }, [navigate, toPrefixedPath, workspaceId]);

  const scenarioOptions = useMemo(
    () => [
      {
        value: NO_SCENARIO_RUN_VALUE,
        label: "Current workspace context",
        meta: "Run without a prior scenario run binding",
      },
      ...scenarioRuns.map((run) => ({
        value: run.id,
        label: scenarioNameFromValue(run.id) ?? run.id,
        meta: [
          run.status,
          run.finishedAt ?? run.startedAt,
        ].filter(Boolean).join(" · "),
      })),
    ],
    [scenarioRuns],
  );

  return (
    <PageShell className="verify-shell">
      <PageGrid as="main" className="verify-layout">
        <Panel className="verify-controls" data-testid="verify-tab-scaffold">
          <div className="verify-controls-header">
            <strong>Verify consistency</strong>
            <span className="secondary-note">
              Run repeated grading checks against one grader and scenario.
            </span>
          </div>
          {scenarioRuns.length > 0 && (
            <Listbox
              label="Scenario run"
              value={selectedScenarioRunId ?? NO_SCENARIO_RUN_VALUE}
              onChange={(runId) => {
                setSelectedScenarioRunId(
                  runId === NO_SCENARIO_RUN_VALUE ? null : runId,
                );
              }}
              options={scenarioOptions}
              placeholder="Select scenario run"
            />
          )}
          <Listbox
            label="Grader"
            value={selectedGraderId ?? ""}
            onChange={(value) =>
              setSelectedGraderId(value.length ? value : null)}
            options={graders.map((grader) => ({
              value: grader.id,
              label: grader.label,
              meta: grader.path,
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
            data-testid="verify-run-batch"
            variant="primary"
            onClick={runBatch}
            disabled={!canRun}
          >
            {hasRunningBatch || runBatchMutation.inFlight
              ? "Running consistency batch…"
              : "Run consistency batch"}
          </Button>
          {graders.length === 0 && (
            <Callout>
              No graders are available. Add <code>[[graders]]</code>{" "}
              entries to the active root deck.
            </Callout>
          )}
          {selectedGrader?.description && (
            <Callout>{selectedGrader.description}</Callout>
          )}
          <Callout variant="emphasis" title="Build assistant stays available">
            Use the chat drawer toggle in the top-right corner to investigate
            and iterate while this page remains open.
          </Callout>
        </Panel>
        <Panel className="verify-results" data-testid="verify-results">
          {mutationError && <div className="error">{mutationError}</div>}
          <div className="verify-status-row">
            <div className="verify-status-main">
              <strong>Batch status</strong>
              <div className="verify-status-meta">
                <Badge status={selectedBatch?.status ?? "idle"}>
                  {selectedBatch?.status ?? "idle"}
                </Badge>
                {selectedBatch?.startedAt
                  ? ` · started ${
                    formatTimestampShort(selectedBatch.startedAt)
                  }`
                  : ""}
                {selectedBatch?.finishedAt
                  ? ` · finished ${
                    formatTimestampShort(selectedBatch.finishedAt)
                  }`
                  : ""}
              </div>
            </div>
            {metrics && metrics.sampleSize > 0 && (
              <span
                className={classNames(
                  "verify-verdict-badge",
                  `verify-verdict-badge--${metrics.verdict.toLowerCase()}`,
                )}
              >
                {metrics.verdict}
              </span>
            )}
          </div>
          {selectedBatch && selectedBatch.requested > 0 && (
            <div className="verify-progress-row">
              <span>Queued: {queuedCount}</span>
              <span>Running: {selectedBatch.active}</span>
              <span>Completed: {selectedBatch.completed}</span>
              <span>Failed: {selectedBatch.failed}</span>
            </div>
          )}
          {!selectedBatch && (
            <Callout>
              Run a consistency batch to compute agreement, spread, and
              instability for the selected grader.
            </Callout>
          )}
          {metrics && metrics.sampleSize > 0 && (
            <>
              <div className="verify-metric-grid">
                <div className="verify-metric-card">
                  <div className="verify-metric-label">Sample size</div>
                  <div className="verify-metric-value">
                    {metrics.sampleSize}
                  </div>
                </div>
                <div className="verify-metric-card">
                  <div className="verify-metric-label">Agreement rate</div>
                  <div className="verify-metric-value">
                    {metrics.agreementRate === null
                      ? "—"
                      : `${Math.round(metrics.agreementRate * 100)}%`}
                  </div>
                </div>
                <div className="verify-metric-card">
                  <div className="verify-metric-label">
                    Score spread (min/median/max)
                  </div>
                  <div className="verify-metric-value verify-metric-value--compact">
                    {metrics.scoreSpreadMin === null
                      ? "—"
                      : `${metrics.scoreSpreadMin} / ${
                        metrics.scoreSpreadMedian ?? "—"
                      } / ${metrics.scoreSpreadMax ?? "—"}`}
                  </div>
                </div>
                <div className="verify-metric-card">
                  <div className="verify-metric-label">Instability count</div>
                  <div className="verify-metric-value">
                    {metrics.instabilityCount}
                  </div>
                </div>
              </div>
              <Callout
                variant={metrics.verdict === "FAIL"
                  ? "danger"
                  : metrics.verdict === "WARN"
                  ? "emphasis"
                  : "muted"}
                title={`Verdict: ${metrics.verdict}`}
              >
                {metrics.verdictReason}
              </Callout>
            </>
          )}
          <Callout title="Thresholds in code">
            Min sample size: {VERIFY_CONSISTENCY_THRESHOLDS.minSampleSize}{" "}
            · PASS requires agreement ≥ {Math.round(
              VERIFY_CONSISTENCY_THRESHOLDS.pass.agreementMin * 100,
            )}
            %, spread ≤{" "}
            {VERIFY_CONSISTENCY_THRESHOLDS.pass.maxSpread}, instability ≤{" "}
            {VERIFY_CONSISTENCY_THRESHOLDS.pass.maxInstabilityCount}{" "}
            · WARN allows agreement ≥ {Math.round(
              VERIFY_CONSISTENCY_THRESHOLDS.warn.agreementMin * 100,
            )}
            %, spread ≤{" "}
            {VERIFY_CONSISTENCY_THRESHOLDS.warn.maxSpread}, instability ≤{" "}
            {VERIFY_CONSISTENCY_THRESHOLDS.warn.maxInstabilityCount}.
          </Callout>

          <div className="verify-section">
            <strong>Most inconsistent examples</strong>
            {topOutliers.length === 0
              ? (
                <Callout>
                  Inconsistent examples will appear here as soon as at least one
                  completed run is available in this batch.
                </Callout>
              )
              : (
                <div className="verify-outlier-list">
                  {topOutliers.map((outlier) => {
                    const runLinks = [outlier.maxRunId, outlier.minRunId]
                      .filter((value): value is string => Boolean(value));
                    const uniqueRunLinks = [...new Set(runLinks)];
                    return (
                      <div key={outlier.key} className="verify-outlier-card">
                        <div className="verify-outlier-header">
                          <strong>{outlier.label}</strong>
                          <Badge
                            variant={outlier.instability
                              ? "error"
                              : "completed"}
                          >
                            {outlier.instability ? "Unstable" : "Stable"}
                          </Badge>
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
                        {uniqueRunLinks.length > 0 && (
                          <div className="verify-outlier-links">
                            {uniqueRunLinks.map((runId) => (
                              <a
                                key={runId}
                                href={toPrefixedPath(
                                  buildWorkspacePath("grade", workspaceId, {
                                    runId,
                                  }),
                                )}
                                onClick={(event) => {
                                  event.preventDefault();
                                  navigateToGradeRun(runId);
                                }}
                              >
                                Open grade run {runId}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
          </div>

          {visibleBatches.length > 0 && (
            <div className="verify-section">
              <strong>Batch history</strong>
              <ul className="verify-request-list">
                {visibleBatches.slice(0, 15).map((batch, index) => (
                  <li key={batch.id} className="verify-request-row">
                    <span className="verify-request-index">#{index + 1}</span>
                    <Badge status={batch.status}>{batch.status}</Badge>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        setSelectedBatchId(batch.id)}
                    >
                      {batch.id}
                    </button>
                    <span className="secondary-note">
                      {batch.completed}/{batch.requested} complete
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selectedBatch?.requests.length
            ? (
              <div className="verify-section">
                <strong>Batch requests</strong>
                <ul className="verify-request-list">
                  {selectedBatch.requests.map((request, index) => (
                    <li key={request.id} className="verify-request-row">
                      <span className="verify-request-index">#{index + 1}</span>
                      <Badge
                        status={request.status === "queued"
                          ? "idle"
                          : request.status}
                      >
                        {request.status}
                      </Badge>
                      {request.runId
                        ? (
                          <a
                            href={toPrefixedPath(
                              buildWorkspacePath("grade", workspaceId, {
                                runId: request.runId,
                              }),
                            )}
                            onClick={(event) => {
                              event.preventDefault();
                              navigateToGradeRun(request.runId as string);
                            }}
                          >
                            {request.runId}
                          </a>
                        )
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
            )
            : null}
        </Panel>
      </PageGrid>
    </PageShell>
  );
});

export default SimulatorVerifyPage;
