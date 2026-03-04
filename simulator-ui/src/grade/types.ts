export type GradeRunStatus = "idle" | "running" | "completed" | "error";

export type GradeRunSectionItem = {
  key: string;
  label: string;
  status: GradeRunStatus;
  runAt?: string;
  error?: string;
  input?: unknown;
  result?: unknown;
  runId: string;
  turnIndex?: number;
  turnNumber?: number;
  refId: string;
  pending?: boolean;
};

export type GradeRunSection = {
  run: {
    id: string;
    status: GradeRunStatus;
    runAt?: string;
    input?: unknown;
    result?: unknown;
  };
  label: string;
  items: Array<GradeRunSectionItem>;
};

export type GradeGraderOption = {
  id: string;
  label: string;
  meta?: string;
  description?: string;
};

export type GradeTestRunOption = {
  value: string;
  label: string;
  meta?: string;
};
