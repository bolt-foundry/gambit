import { iso } from "@iso-gambit-sim";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { buildWorkspacePath } from "../../../../src/workspace_routes.ts";
import gambitWorkspaceVerifyBatchRunCreateMutation from "../../../mutations/GambitWorkspaceVerifyBatchRunCreateMutation.ts";
import gambitWorkspaceVerifyLiveSubscription from "../../../subscriptions/GambitWorkspaceVerifyLiveSubscription.ts";
import { useGambitTypedMutation } from "../../../src/hooks/useGambitTypedMutation.tsx";
import { useGambitTypedSubscription } from "../../../src/hooks/useGambitTypedSubscription.tsx";
import { useRouter } from "../../../src/RouterContext.tsx";
import Badge from "../../../src/gds/Badge.tsx";
import Button from "../../../src/gds/Button.tsx";
import Callout from "../../../src/gds/Callout.tsx";
import Icon from "../../../src/gds/Icon.tsx";
import Listbox from "../../../src/gds/Listbox.tsx";
import PageGrid from "../../../src/gds/PageGrid.tsx";
import PageShell from "../../../src/gds/PageShell.tsx";
import Panel from "../../../src/gds/Panel.tsx";
import Tabs from "../../../src/gds/Tabs.tsx";
import Tooltip from "../../../src/gds/Tooltip.tsx";
import type {
  VerifyBatchRequestStatus,
  VerifyBatchStatus,
  VerifyBatchView,
  VerifyResultsTabId,
} from "./SimulatorVerifyPageTypes.ts";
import {
  formatTimestampShort,
  scenarioNameFromValue,
} from "../../../src/utils.ts";
import {
  mergeWorkbenchSelectedContextChip,
  replaceWorkbenchSelectedContextChips,
  resolveWorkbenchSelectedContextChips,
} from "../../../src/workbenchChipStore.ts";
import {
  type WorkbenchSelectedContextChip,
} from "../../../src/workbenchContext.ts";
import {
  sortVerifyOutlierScenarioRuns,
  VERIFY_DEFAULTS,
  VERIFY_LIMITS,
} from "../../../src/verify_unified.ts";

const MAX_SCENARIO_RUNS = VERIFY_LIMITS.scenarioRunsMax;
const MAX_GRADER_REPEATS = VERIFY_LIMITS.graderRepeatsMax;
const MAX_BATCH_CONCURRENCY = VERIFY_LIMITS.concurrencyMax;
const DEFAULT_SCENARIO_RUNS = VERIFY_DEFAULTS.scenarioRuns;
const DEFAULT_GRADER_REPEATS = VERIFY_DEFAULTS.graderRepeatsPerScenario;
const DEFAULT_BATCH_CONCURRENCY = VERIFY_DEFAULTS.concurrency;

type VerifySettingsMenuProps = {
  batchConcurrency: number;
  onBatchConcurrencyChange: (value: number) => void;
};

function VerifySettingsMenu(props: VerifySettingsMenuProps) {
  const { batchConcurrency, onBatchConcurrencyChange } = props;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties | null>(
    null,
  );

  const updatePopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const offset = 6;
    const viewportPadding = 8;
    const popoverHeight = popoverRef.current?.offsetHeight ?? 0;
    const style: React.CSSProperties = {
      position: "fixed",
      top: rect.bottom + offset,
      left: rect.right,
      minWidth: 240,
      transform: "translateX(-100%)",
    };
    if (
      popoverHeight > 0 &&
      rect.bottom + offset + popoverHeight >
        window.innerHeight - viewportPadding
    ) {
      style.top = Math.max(
        viewportPadding,
        rect.top - offset - popoverHeight,
      );
    }
    setPopoverStyle((prev) => {
      if (
        prev?.top === style.top &&
        prev?.left === style.left &&
        prev?.minWidth === style.minWidth &&
        prev?.transform === style.transform
      ) {
        return prev;
      }
      return style;
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopover();
  }, [open, updatePopover]);

  useLayoutEffect(() => {
    if (!open || !popoverStyle || !popoverRef.current) return;
    updatePopover();
  }, [open, popoverStyle, updatePopover]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const inTrigger = triggerRef.current && target &&
        triggerRef.current.contains(target);
      const inPopover = popoverRef.current && target &&
        popoverRef.current.contains(target);
      if (!inTrigger && !inPopover) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    const handleReposition = () => updatePopover();
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    globalThis.addEventListener("resize", handleReposition);
    globalThis.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
      globalThis.removeEventListener("resize", handleReposition);
      globalThis.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, updatePopover]);

  return (
    <>
      <button
        type="button"
        className={open
          ? "verify-settings-trigger verify-settings-trigger--open"
          : "verify-settings-trigger"}
        aria-label="Configure verify batch settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((prev) => !prev)}
        ref={triggerRef}
      >
        <Icon name="settings" size={16} />
      </button>
      {open && popoverStyle &&
        createPortal(
          <div
            className="gds-listbox-popover verify-settings-menu"
            role="dialog"
            aria-label="Verify batch settings"
            style={popoverStyle}
            ref={popoverRef}
          >
            <label className="verify-settings-menu-row">
              <span>Concurrency</span>
              <input
                type="number"
                min={1}
                max={MAX_BATCH_CONCURRENCY}
                value={batchConcurrency}
                onChange={(event) =>
                  onBatchConcurrencyChange(
                    clampInt(
                      Number(event.target.value),
                      1,
                      MAX_BATCH_CONCURRENCY,
                    ),
                  )}
              />
            </label>
          </div>,
          document.body,
        )}
    </>
  );
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

function formatPercent(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.round(value * 100)}%`;
}

export const SimulatorVerifyPage = iso(`
  field Workspace.VerifyTab @component {
    id
    workbenchSelectedContextChips @updatable
    scenarioDecks {
      id
      label
      description
      path
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
            scenarioDeckId
            graderId
            scenarioRuns
            graderRepeatsPerScenario
            status
            startedAt
            finishedAt
            requested
            active
            completed
            failed
            scenarioRunsCompleted
            scenarioRunsFailed
            requests(first: 200) {
              edges {
                node {
                  id
                  scenarioRunId
                  status
                  runId
                  error
                }
              }
            }
            metrics {
              scenarioRunCountRequested
              scenarioRunCountCompleted
              scenarioRunCountFailed
              gradeSampleCountRequested
              gradeSampleCountCompleted
              gradeSampleCountFailed
              executionFailureCount
              gradingFailureCount
              passRate
              scoreMin
              scoreMedian
              scoreMax
              scoreMean
              outlierScenarioRuns(first: 25) {
                edges {
                  node {
                    key
                    scenarioRunId
                    gradeSampleCount
                    completedSampleCount
                    executionFailureCount
                    gradingFailureCount
                    averageScore
                    minScore
                    maxScore
                    failed
                    minRunId
                    maxRunId
                    messageRefId
                  }
                }
              }
              failureReasons(first: 25) {
                edges {
                  node {
                    key
                    kind
                    reason
                    count
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`)(function SimulatorVerifyPage({ data, startUpdate }) {
  const workspaceId = data.id ?? "";
  const composerChips = useMemo(
    () =>
      resolveWorkbenchSelectedContextChips(
        workspaceId,
        data.workbenchSelectedContextChips,
      ),
    [data.workbenchSelectedContextChips, workspaceId],
  );
  const updateComposerChips = useCallback(
    (next: Array<WorkbenchSelectedContextChip>) => {
      replaceWorkbenchSelectedContextChips(startUpdate, next, workspaceId);
    },
    [startUpdate, workspaceId],
  );
  const { navigate } = useRouter();

  const runBatchMutation = useGambitTypedMutation(
    gambitWorkspaceVerifyBatchRunCreateMutation,
  );

  useGambitTypedSubscription(
    gambitWorkspaceVerifyLiveSubscription,
    workspaceId ? { workspaceId } : null,
  );

  const scenarioDecks = useMemo(
    () =>
      data.scenarioDecks?.flatMap((deck) => {
        if (!deck?.id || !deck.label) return [];
        return [{
          id: deck.id,
          label: deck.label,
          description: deck.description ?? null,
          path: deck.path ?? "",
        }];
      }) ?? [],
    [data.scenarioDecks],
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

  const batches = useMemo<Array<VerifyBatchView>>(
    () =>
      (data.verification?.batches?.edges ?? []).flatMap((edge) => {
        const batch = edge?.node;
        if (!batch?.id || !batch.graderId) return [];
        return [{
          id: batch.id,
          scenarioDeckId: batch.scenarioDeckId ?? null,
          graderId: batch.graderId,
          scenarioRuns: batch.scenarioRuns ?? 0,
          graderRepeatsPerScenario: batch.graderRepeatsPerScenario ?? 0,
          status: toBatchStatus(batch.status),
          startedAt: batch.startedAt ?? null,
          finishedAt: batch.finishedAt ?? null,
          requested: batch.requested ?? 0,
          active: batch.active ?? 0,
          completed: batch.completed ?? 0,
          failed: batch.failed ?? 0,
          scenarioRunsCompleted: batch.scenarioRunsCompleted ?? 0,
          scenarioRunsFailed: batch.scenarioRunsFailed ?? 0,
          requests: (batch.requests?.edges ?? []).flatMap((requestEdge) => {
            const request = requestEdge?.node;
            if (!request?.id) return [];
            return [{
              id: request.id,
              scenarioRunId: request.scenarioRunId ?? undefined,
              status: toBatchRequestStatus(request.status),
              runId: request.runId ?? undefined,
              error: request.error ?? undefined,
            }];
          }),
          metrics: batch.metrics
            ? {
              scenarioRunCountRequested:
                batch.metrics.scenarioRunCountRequested ?? 0,
              scenarioRunCountCompleted:
                batch.metrics.scenarioRunCountCompleted ?? 0,
              scenarioRunCountFailed: batch.metrics.scenarioRunCountFailed ?? 0,
              gradeSampleCountRequested:
                batch.metrics.gradeSampleCountRequested ?? 0,
              gradeSampleCountCompleted:
                batch.metrics.gradeSampleCountCompleted ?? 0,
              gradeSampleCountFailed: batch.metrics.gradeSampleCountFailed ?? 0,
              executionFailureCount: batch.metrics.executionFailureCount ?? 0,
              gradingFailureCount: batch.metrics.gradingFailureCount ?? 0,
              passRate: typeof batch.metrics.passRate === "number"
                ? batch.metrics.passRate
                : null,
              scoreMin: typeof batch.metrics.scoreMin === "number"
                ? batch.metrics.scoreMin
                : null,
              scoreMedian: typeof batch.metrics.scoreMedian === "number"
                ? batch.metrics.scoreMedian
                : null,
              scoreMax: typeof batch.metrics.scoreMax === "number"
                ? batch.metrics.scoreMax
                : null,
              scoreMean: typeof batch.metrics.scoreMean === "number"
                ? batch.metrics.scoreMean
                : null,
              outlierScenarioRuns:
                (batch.metrics.outlierScenarioRuns?.edges ?? []).flatMap(
                  (outlierEdge) => {
                    const outlier = outlierEdge?.node;
                    if (!outlier?.key || !outlier.scenarioRunId) return [];
                    return [{
                      key: outlier.key,
                      scenarioRunId: outlier.scenarioRunId,
                      gradeSampleCount: outlier.gradeSampleCount ?? 0,
                      completedSampleCount: outlier.completedSampleCount ?? 0,
                      executionFailureCount: outlier.executionFailureCount ?? 0,
                      gradingFailureCount: outlier.gradingFailureCount ?? 0,
                      averageScore: typeof outlier.averageScore === "number"
                        ? outlier.averageScore
                        : null,
                      minScore: typeof outlier.minScore === "number"
                        ? outlier.minScore
                        : null,
                      maxScore: typeof outlier.maxScore === "number"
                        ? outlier.maxScore
                        : null,
                      failed: Boolean(outlier.failed),
                      minRunId: outlier.minRunId ?? undefined,
                      maxRunId: outlier.maxRunId ?? undefined,
                      messageRefId: outlier.messageRefId ?? undefined,
                    }];
                  },
                ),
              failureReasons: (batch.metrics.failureReasons?.edges ?? [])
                .flatMap(
                  (reasonEdge) => {
                    const reason = reasonEdge?.node;
                    if (!reason?.key || !reason.reason) return [];
                    return [{
                      key: reason.key,
                      kind: reason.kind === "GRADING" ? "grading" : "execution",
                      reason: reason.reason,
                      count: reason.count ?? 0,
                    }];
                  },
                ),
            }
            : null,
        }];
      }),
    [data.verification?.batches?.edges],
  );

  const [selectedScenarioDeckId, setSelectedScenarioDeckId] = useState<
    string | null
  >(null);
  const [selectedGraderId, setSelectedGraderId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [scenarioRuns, setScenarioRuns] = useState<number>(
    DEFAULT_SCENARIO_RUNS,
  );
  const [graderRepeatsPerScenario, setGraderRepeatsPerScenario] = useState<
    number
  >(DEFAULT_GRADER_REPEATS);
  const [batchConcurrency, setBatchConcurrency] = useState<number>(
    DEFAULT_BATCH_CONCURRENCY,
  );
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [resultsTab, setResultsTab] = useState<VerifyResultsTabId>("insights");

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
      selectedScenarioDeckId &&
      scenarioDecks.some((deck) => deck.id === selectedScenarioDeckId)
    ) {
      return;
    }
    setSelectedScenarioDeckId(scenarioDecks[0]?.id ?? null);
  }, [scenarioDecks, selectedScenarioDeckId]);

  const filteredBatches = useMemo(() => {
    return batches.filter((batch) => {
      if (selectedGraderId && batch.graderId !== selectedGraderId) return false;
      if (
        selectedScenarioDeckId &&
        batch.scenarioDeckId !== selectedScenarioDeckId
      ) {
        return false;
      }
      return true;
    });
  }, [batches, selectedGraderId, selectedScenarioDeckId]);

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

  const selectedScenarioDeck = useMemo(
    () =>
      scenarioDecks.find((deck) => deck.id === selectedScenarioDeckId) ?? null,
    [scenarioDecks, selectedScenarioDeckId],
  );

  const queuedCount = useMemo(
    () =>
      (selectedBatch?.requests ?? []).filter((request) =>
        request.status === "queued"
      ).length,
    [selectedBatch?.requests],
  );

  const metrics = selectedBatch?.metrics ?? null;
  const topOutlierScenarioRuns = useMemo(
    () =>
      sortVerifyOutlierScenarioRuns(metrics?.outlierScenarioRuns ?? [])
        .slice(0, 8),
    [metrics?.outlierScenarioRuns],
  );

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
    const nextScenarioRuns = clampInt(scenarioRuns, 1, MAX_SCENARIO_RUNS);
    const nextRepeats = clampInt(
      graderRepeatsPerScenario,
      1,
      MAX_GRADER_REPEATS,
    );
    const nextConcurrency = clampInt(
      batchConcurrency,
      1,
      MAX_BATCH_CONCURRENCY,
    );
    runBatchMutation.commit(
      {
        input: {
          workspaceId,
          ...(selectedScenarioDeckId
            ? { scenarioDeckId: selectedScenarioDeckId }
            : {}),
          graderId: selectedGraderId,
          scenarioRuns: nextScenarioRuns,
          graderRepeatsPerScenario: nextRepeats,
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
    graderRepeatsPerScenario,
    runBatchMutation,
    scenarioRuns,
    selectedGraderId,
    selectedScenarioDeckId,
    workspaceId,
  ]);

  const navigateToGradeRun = useCallback((runId: string) => {
    const gradePath = buildWorkspacePath("grade", workspaceId, { runId });
    navigate(gradePath);
  }, [navigate, workspaceId]);
  const totalRequestedRuns = scenarioRuns * graderRepeatsPerScenario;

  return (
    <PageShell className="verify-shell">
      <PageGrid as="main" className="verify-layout">
        <Panel className="verify-controls" data-testid="verify-tab-scaffold">
          <div className="verify-controls-header">
            <strong>Verify repeated evidence</strong>
            <span className="secondary-note">
              Generate scenario runs, then grade each run repeatedly.
            </span>
          </div>
          <Callout>
            <div className="verify-controls-row flex-column gap-8">
              <div className="verify-listbox-with-info">
                <div className="verify-listbox-with-info-field">
                  <Listbox
                    label="Scenario"
                    value={selectedScenarioDeckId ?? ""}
                    onChange={(value) =>
                      setSelectedScenarioDeckId(value.length ? value : null)}
                    options={scenarioDecks.map((deck) => ({
                      value: deck.id,
                      label: deck.label,
                      meta: deck.path,
                      triggerMeta: null,
                    }))}
                    placeholder="Select scenario deck"
                    disabled={scenarioDecks.length === 0}
                  />
                </div>
                {selectedScenarioDeck?.description && (
                  <Tooltip content={selectedScenarioDeck.description}>
                    <span
                      className="verify-listbox-info-icon"
                      aria-label="Show scenario deck description"
                      role="img"
                    >
                      <Icon name="circleInfo" size={16} />
                    </span>
                  </Tooltip>
                )}
              </div>
              {scenarioDecks.length === 0 && (
                <Callout>
                  No scenario decks are available. Add{" "}
                  <code>[[scenarios]]</code> entries to the active root deck.
                </Callout>
              )}
              <div className="verify-controls-row-scenario-runs">
                <label className="verify-number-field verify-number-field--inline">
                  <span>Scenario runs</span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_SCENARIO_RUNS}
                    value={scenarioRuns}
                    onChange={(event) =>
                      setScenarioRuns(
                        clampInt(
                          Number(event.target.value),
                          1,
                          MAX_SCENARIO_RUNS,
                        ),
                      )}
                  />
                </label>
              </div>
            </div>
          </Callout>
          <Callout>
            <div className="verify-controls-row flex-column gap-8">
              <div className="verify-listbox-with-info">
                <div className="verify-listbox-with-info-field">
                  <Listbox
                    label="Grader"
                    value={selectedGraderId ?? ""}
                    onChange={(value) =>
                      setSelectedGraderId(value.length ? value : null)}
                    options={graders.map((grader) => ({
                      value: grader.id,
                      label: grader.label,
                      meta: grader.path,
                      triggerMeta: null,
                    }))}
                    placeholder="Select grader"
                    disabled={graders.length === 0}
                  />
                </div>
                {selectedGrader?.description && (
                  <Tooltip content={selectedGrader.description}>
                    <span
                      className="verify-listbox-info-icon"
                      aria-label="Show grader description"
                      role="img"
                    >
                      <Icon name="circleInfo" size={16} />
                    </span>
                  </Tooltip>
                )}
              </div>
              {graders.length === 0 && (
                <Callout>
                  No graders are available. Add <code>[[graders]]</code>{" "}
                  entries to the active root deck.
                </Callout>
              )}
              <div className="verify-controls-row-scenario-runs">
                <label className="verify-number-field verify-number-field--inline">
                  <span>Grader repeats per scenario</span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_GRADER_REPEATS}
                    value={graderRepeatsPerScenario}
                    onChange={(event) =>
                      setGraderRepeatsPerScenario(
                        clampInt(
                          Number(event.target.value),
                          1,
                          MAX_GRADER_REPEATS,
                        ),
                      )}
                  />
                </label>
              </div>
            </div>
          </Callout>
          <div className="verify-run-summary">
            <strong>{scenarioRuns}</strong> scenario &times;{" "}
            <strong>{graderRepeatsPerScenario}</strong> grader ={" "}
            <strong>{totalRequestedRuns}</strong> total runs
          </div>
          <div className="verify-run-row">
            <Button
              data-testid="verify-run-batch"
              variant="primary"
              onClick={runBatch}
              disabled={!canRun}
            >
              {hasRunningBatch || runBatchMutation.inFlight
                ? "Running verify batch..."
                : "Run verify batch"}
            </Button>
            <VerifySettingsMenu
              batchConcurrency={batchConcurrency}
              onBatchConcurrencyChange={setBatchConcurrency}
            />
          </div>
        </Panel>
        <Panel className="verify-results" data-testid="verify-results">
          {mutationError && <div className="error">{mutationError}</div>}
          <Tabs
            className="panel-tabs"
            size="small"
            activeId={resultsTab}
            onChange={(next) => setResultsTab(next as VerifyResultsTabId)}
            tabs={[
              {
                id: "insights",
                label: "Insights",
                testId: "verify-results-tab-insights",
              },
              {
                id: "batchActivity",
                label: "Batch activity",
                testId: "verify-results-tab-batch-activity",
              },
            ]}
          />
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
          </div>

          {!selectedBatch && (
            <Callout>
              Run a verify batch to generate repeated grading evidence.
            </Callout>
          )}

          {selectedBatch && selectedBatch.requested > 0 && (
            <>
              <div className="verify-progress-row">
                <span>
                  Scenario runs: {selectedBatch.scenarioRunsCompleted}/
                  {selectedBatch.scenarioRuns}
                </span>
                <span>
                  Scenario failures: {selectedBatch.scenarioRunsFailed}
                </span>
                <span>Queued: {queuedCount}</span>
                <span>Running: {selectedBatch.active}</span>
                <span>Completed: {selectedBatch.completed}</span>
                <span>Failed: {selectedBatch.failed}</span>
              </div>
            </>
          )}

          {resultsTab === "insights" && (
            <>
              {metrics && (
                <div className="verify-metric-grid">
                  <div className="verify-metric-card">
                    <div className="verify-metric-label">Scenario runs</div>
                    <div className="verify-metric-value">
                      {metrics.scenarioRunCountCompleted}/
                      {metrics.scenarioRunCountRequested}
                    </div>
                  </div>
                  <div className="verify-metric-card">
                    <div className="verify-metric-label">Grade samples</div>
                    <div className="verify-metric-value">
                      {metrics.gradeSampleCountCompleted}/
                      {metrics.gradeSampleCountRequested}
                    </div>
                  </div>
                  <div className="verify-metric-card">
                    <div className="verify-metric-label">Pass rate</div>
                    <div className="verify-metric-value">
                      {formatPercent(metrics.passRate)}
                    </div>
                  </div>
                  <div className="verify-metric-card">
                    <div className="verify-metric-label">Score mean</div>
                    <div className="verify-metric-value">
                      {metrics.scoreMean === null ? "-" : metrics.scoreMean}
                    </div>
                  </div>
                  <div className="verify-metric-card">
                    <div className="verify-metric-label">
                      Score min/median/max
                    </div>
                    <div className="verify-metric-value verify-metric-value--compact">
                      {metrics.scoreMin === null
                        ? "-"
                        : `${metrics.scoreMin} / ${
                          metrics.scoreMedian ?? "-"
                        } / ${metrics.scoreMax ?? "-"}`}
                    </div>
                  </div>
                  <div className="verify-metric-card">
                    <div className="verify-metric-label">
                      Execution failures
                    </div>
                    <div className="verify-metric-value">
                      {metrics.executionFailureCount}
                    </div>
                  </div>
                  <div className="verify-metric-card">
                    <div className="verify-metric-label">Grading failures</div>
                    <div className="verify-metric-value">
                      {metrics.gradingFailureCount}
                    </div>
                  </div>
                </div>
              )}

              <div className="verify-section">
                <strong>Outlier scenario runs</strong>
                {topOutlierScenarioRuns.length === 0
                  ? (
                    <Callout>
                      Outlier scenario runs appear as soon as completed grade
                      samples are available.
                    </Callout>
                  )
                  : (
                    <div className="verify-outlier-list">
                      {topOutlierScenarioRuns.map((outlier) => {
                        const runLinks = [outlier.minRunId, outlier.maxRunId]
                          .filter((value): value is string => Boolean(value));
                        const uniqueRunLinks = [...new Set(runLinks)];
                        return (
                          <div
                            key={outlier.key}
                            className="verify-outlier-card"
                          >
                            <div className="verify-outlier-header">
                              <strong>
                                {scenarioNameFromValue(outlier.scenarioRunId) ??
                                  outlier.scenarioRunId}
                              </strong>
                              <Badge
                                variant={outlier.failed ? "error" : "completed"}
                              >
                                {outlier.failed ? "Failed" : "Scored"}
                              </Badge>
                            </div>
                            <div className="verify-outlier-meta">
                              avg {outlier.averageScore ?? "-"} · min/max{" "}
                              {outlier.minScore ?? "-"}/
                              {outlier.maxScore ?? "-"} · samples{" "}
                              {outlier.completedSampleCount}/
                              {outlier.gradeSampleCount} · execution failures
                              {" "}
                              {outlier.executionFailureCount} · grading failures
                              {" "}
                              {outlier.gradingFailureCount}
                              {outlier.messageRefId
                                ? ` · ref ${outlier.messageRefId}`
                                : ""}
                            </div>
                            <div className="verify-outlier-links">
                              <button
                                type="button"
                                className="link-button"
                                data-testid="verify-outlier-add-to-chat"
                                onClick={() =>
                                  updateComposerChips(
                                    mergeWorkbenchSelectedContextChip(
                                      composerChips,
                                      {
                                        chipId: `verify:${outlier.key}`,
                                        source: "verify_outlier",
                                        workspaceId,
                                        runId: outlier.maxRunId ??
                                          outlier.minRunId,
                                        capturedAt: new Date().toISOString(),
                                        batchId: selectedBatch?.id,
                                        scenarioRunId: outlier.scenarioRunId,
                                        messageRefId: outlier.messageRefId,
                                        score: outlier.averageScore ??
                                          undefined,
                                        instability: (outlier.maxScore ?? 0) -
                                            (outlier.minScore ?? 0) >= 2,
                                        message: `${
                                          scenarioNameFromValue(
                                            outlier.scenarioRunId,
                                          ) ??
                                            outlier.scenarioRunId
                                        }: avg ${
                                          outlier.averageScore ?? "-"
                                        }, min/max ${outlier.minScore ?? "-"}/${
                                          outlier.maxScore ?? "-"
                                        }, samples ${outlier.completedSampleCount}/${outlier.gradeSampleCount}`,
                                        enabled: true,
                                      },
                                    ),
                                  )}
                              >
                                Add to chat
                              </button>
                            </div>
                            {uniqueRunLinks.length > 0 && (
                              <div className="verify-outlier-links">
                                {uniqueRunLinks.map((runId) => (
                                  <a
                                    key={runId}
                                    href={buildWorkspacePath(
                                      "grade",
                                      workspaceId,
                                      { runId },
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

              <div className="verify-section">
                <strong>Failure reasons</strong>
                {!metrics || metrics.failureReasons.length === 0
                  ? <Callout>No failure reasons captured yet.</Callout>
                  : (
                    <ul className="verify-request-list">
                      {metrics.failureReasons.map((reason) => (
                        <li key={reason.key} className="verify-request-row">
                          <Badge
                            variant={reason.kind === "execution"
                              ? "error"
                              : "running"}
                          >
                            {reason.kind}
                          </Badge>
                          <span>{reason.reason}</span>
                          <span className="secondary-note">
                            x{reason.count}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            </>
          )}

          {resultsTab === "batchActivity" && (
            <>
              {visibleBatches.length > 0 && (
                <div className="verify-section">
                  <strong>Batch history</strong>
                  <ul className="verify-request-list">
                    {visibleBatches.slice(0, 15).map((batch, index) => (
                      <li key={batch.id} className="verify-request-row">
                        <span className="verify-request-index">
                          #{index + 1}
                        </span>
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
                          {batch.scenarioRuns} runs ×{" "}
                          {batch.graderRepeatsPerScenario}
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
                          {request.scenarioRunId && (
                            <span className="secondary-note">
                              {scenarioNameFromValue(request.scenarioRunId) ??
                                request.scenarioRunId}
                            </span>
                          )}
                          {request.runId
                            ? (
                              <a
                                href={buildWorkspacePath("grade", workspaceId, {
                                  runId: request.runId,
                                })}
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
            </>
          )}
        </Panel>
      </PageGrid>
    </PageShell>
  );
});

export default SimulatorVerifyPage;
