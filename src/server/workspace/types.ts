import type {
  FeedbackEntry,
  SavedState,
  TraceEvent,
} from "@bolt-foundry/gambit-core";

export type WorkspaceRunToolInsert = {
  actionCallId?: string;
  parentActionCallId?: string;
  name?: string;
  index: number;
};

export type TestBotRunMessage = {
  role: string;
  content: string;
  messageRefId?: string;
  messageSource?: "scenario" | "manual" | "artifact";
  feedback?: FeedbackEntry;
  respondStatus?: number;
  respondCode?: string;
  respondMessage?: string;
  respondPayload?: unknown;
  respondMeta?: Record<string, unknown>;
};

export type TestBotInitFill = {
  requested: Array<string>;
  applied?: unknown;
  provided?: unknown;
  error?: string;
};

export type TestBotRunStatus = {
  initFill?: TestBotInitFill;
  id: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  workspaceId?: string;
  // Temporary alias while simulator UI migrates off sessionId naming.
  sessionId?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  maxTurns?: number;
  messages: Array<TestBotRunMessage>;
  traces?: Array<TraceEvent>;
  toolInserts?: Array<WorkspaceRunToolInsert>;
};

export type TestBotRunEntry = {
  run: TestBotRunStatus;
  state: SavedState | null;
  promise: Promise<void> | null;
  abort: AbortController | null;
};

export type BuildBotRunStatus = {
  id: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  messages: Array<TestBotRunMessage>;
  traces?: Array<TraceEvent>;
  toolInserts?: Array<WorkspaceRunToolInsert>;
};

export type BuildBotRunEntry = {
  run: BuildBotRunStatus;
  state: SavedState | null;
  promise: Promise<void> | null;
  abort: AbortController | null;
};

export type WorkspaceVerifyBatchRequestRecordForGraphql = {
  id: string;
  status: "queued" | "running" | "completed" | "error";
  scenarioRunId?: string;
  runId?: string;
  error?: string;
};

export type WorkspaceVerifyBatchRecordForGraphql = {
  id: string;
  workspaceId: string;
  scenarioDeckId?: string;
  graderId: string;
  scenarioRuns: number;
  graderRepeatsPerScenario: number;
  status: "idle" | "running" | "completed" | "error";
  startedAt?: string;
  finishedAt?: string;
  requested: number;
  active: number;
  completed: number;
  failed: number;
  scenarioRunsCompleted: number;
  scenarioRunsFailed: number;
  requests: Array<WorkspaceVerifyBatchRequestRecordForGraphql>;
};

export type WorkspaceGradeRunTurnForGraphql = {
  id: string;
  runId: string;
  turnIndex: number;
  turnNumber: number;
  refId: string;
  score?: number;
  reason?: string;
  priorUser?: string;
  gradedAssistant?: string;
};

export type WorkspaceGradeRunForGraphql = {
  id: string;
  workspaceId: string;
  scenarioRunId?: string;
  graderId: string;
  graderPath: string;
  graderLabel?: string;
  status: "running" | "completed" | "error";
  runAt?: string;
  error?: string;
  summary?: {
    score?: number;
    reason?: string;
  };
  turns: Array<WorkspaceGradeRunTurnForGraphql>;
};

export type WorkspaceConversationSessionKindForGraphql =
  | "build"
  | "scenario"
  | "grader"
  | "verify";

export type WorkspaceConversationSessionRecordForGraphql = {
  sessionId: string;
  workspaceId: string;
  kind: WorkspaceConversationSessionKindForGraphql;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  buildRun?: BuildBotRunStatus;
  scenarioRun?: TestBotRunStatus;
  gradeRun?: WorkspaceGradeRunForGraphql;
  verifyBatch?: WorkspaceVerifyBatchRecordForGraphql;
};
