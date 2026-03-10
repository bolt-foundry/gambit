export type VerifyBatchStatus = "idle" | "running" | "completed" | "error";

export type VerifyBatchRequestStatus =
  | "queued"
  | "running"
  | "completed"
  | "error";

export type VerifyOutlierScenarioRunView = {
  key: string;
  scenarioRunId: string;
  gradeSampleCount: number;
  completedSampleCount: number;
  executionFailureCount: number;
  gradingFailureCount: number;
  averageScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  failed: boolean;
  minRunId?: string;
  maxRunId?: string;
  messageRefId?: string;
};

export type VerifyFailureReasonView = {
  key: string;
  kind: "execution" | "grading";
  reason: string;
  count: number;
};

export type VerifyMetricsView = {
  scenarioRunCountRequested: number;
  scenarioRunCountCompleted: number;
  scenarioRunCountFailed: number;
  gradeSampleCountRequested: number;
  gradeSampleCountCompleted: number;
  gradeSampleCountFailed: number;
  executionFailureCount: number;
  gradingFailureCount: number;
  passRate: number | null;
  scoreMin: number | null;
  scoreMedian: number | null;
  scoreMax: number | null;
  scoreMean: number | null;
  outlierScenarioRuns: Array<VerifyOutlierScenarioRunView>;
  failureReasons: Array<VerifyFailureReasonView>;
};

export type VerifyBatchView = {
  id: string;
  scenarioDeckId: string | null;
  graderId: string;
  scenarioRuns: number;
  graderRepeatsPerScenario: number;
  status: VerifyBatchStatus;
  startedAt: string | null;
  finishedAt: string | null;
  requested: number;
  active: number;
  completed: number;
  failed: number;
  scenarioRunsCompleted: number;
  scenarioRunsFailed: number;
  requests: Array<{
    id: string;
    scenarioRunId?: string;
    status: VerifyBatchRequestStatus;
    runId?: string;
    error?: string;
  }>;
  metrics: VerifyMetricsView | null;
};

export type VerifyResultsTabId = "insights" | "batchActivity";
