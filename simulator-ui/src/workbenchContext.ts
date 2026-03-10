export type WorkbenchErrorContext = {
  source: "scenario_run_error" | "grader_run_error";
  workspaceId?: string;
  runId?: string;
  capturedAt: string;
  error: string;
};

export type WorkbenchRatingContext = {
  source: "message_rating";
  workspaceId?: string;
  runId?: string;
  capturedAt: string;
  messageRefId: string;
  statePath?: string;
  statePointer?: string;
  score: number;
  reason?: string;
};

export type WorkbenchFlagContext = {
  source: "grading_flag";
  workspaceId?: string;
  runId?: string;
  capturedAt: string;
  flagId?: string;
  refId: string;
  score?: number;
  message: string;
};

export type WorkbenchVerifyOutlierContext = {
  source: "verify_outlier";
  workspaceId?: string;
  runId?: string;
  capturedAt: string;
  batchId?: string;
  scenarioRunId: string;
  messageRefId?: string;
  score?: number;
  instability?: boolean;
  message: string;
};

export type WorkbenchMessageContext =
  | WorkbenchErrorContext
  | WorkbenchRatingContext
  | WorkbenchFlagContext
  | WorkbenchVerifyOutlierContext;

export type WorkbenchSelectedContextChip = WorkbenchMessageContext & {
  chipId: string;
  enabled: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function asOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function parseWorkbenchMessageContext(
  value: unknown,
): WorkbenchMessageContext | null {
  const record = asRecord(value);
  if (!record) return null;
  const capturedAt = asOptionalString(record.capturedAt);
  if (!capturedAt) return null;
  const workspaceId = asOptionalString(record.workspaceId);
  const runId = asOptionalString(record.runId);

  if (
    record.source === "scenario_run_error" ||
    record.source === "grader_run_error"
  ) {
    const error = asOptionalString(record.error);
    if (!error) return null;
    return {
      source: record.source,
      workspaceId,
      runId,
      capturedAt,
      error,
    };
  }

  if (record.source === "message_rating") {
    const messageRefId = asOptionalString(record.messageRefId);
    const score = asOptionalFiniteNumber(record.score);
    if (!messageRefId || score === undefined) return null;
    return {
      source: "message_rating",
      workspaceId,
      runId,
      capturedAt,
      messageRefId,
      statePath: asOptionalString(record.statePath),
      statePointer: asOptionalString(record.statePointer),
      score,
      reason: asOptionalString(record.reason),
    };
  }

  if (record.source === "grading_flag") {
    const refId = asOptionalString(record.refId);
    const message = asOptionalString(record.message);
    if (!refId || !message) return null;
    return {
      source: "grading_flag",
      workspaceId,
      runId,
      capturedAt,
      flagId: asOptionalString(record.flagId),
      refId,
      score: asOptionalFiniteNumber(record.score),
      message,
    };
  }

  if (record.source === "verify_outlier") {
    const scenarioRunId = asOptionalString(record.scenarioRunId);
    const message = asOptionalString(record.message);
    if (!scenarioRunId || !message) return null;
    return {
      source: "verify_outlier",
      workspaceId,
      runId,
      capturedAt,
      batchId: asOptionalString(record.batchId),
      scenarioRunId,
      messageRefId: asOptionalString(record.messageRefId),
      score: asOptionalFiniteNumber(record.score),
      instability: typeof record.instability === "boolean"
        ? record.instability
        : undefined,
      message,
    };
  }

  return null;
}

export function parseWorkbenchSelectedContextChip(
  value: unknown,
): WorkbenchSelectedContextChip | null {
  const record = asRecord(value);
  if (!record) return null;
  const chipId = asOptionalString(record.chipId);
  const context = parseWorkbenchMessageContext(record);
  if (!chipId || !context) return null;
  return {
    chipId,
    enabled: record.enabled !== false,
    ...context,
  };
}

export function parseWorkbenchSelectedContextChips(
  value: unknown,
): Array<WorkbenchSelectedContextChip> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => parseWorkbenchSelectedContextChip(entry)).filter(
    (entry): entry is WorkbenchSelectedContextChip => Boolean(entry),
  );
}

export function toWorkbenchMessageContext(
  chip: WorkbenchSelectedContextChip,
): WorkbenchMessageContext {
  if (chip.source === "message_rating") {
    return {
      source: chip.source,
      workspaceId: chip.workspaceId,
      runId: chip.runId,
      capturedAt: chip.capturedAt,
      messageRefId: chip.messageRefId,
      statePath: chip.statePath,
      statePointer: chip.statePointer,
      score: chip.score,
      reason: chip.reason,
    };
  }
  if (chip.source === "grading_flag") {
    return {
      source: chip.source,
      workspaceId: chip.workspaceId,
      runId: chip.runId,
      capturedAt: chip.capturedAt,
      flagId: chip.flagId,
      refId: chip.refId,
      score: chip.score,
      message: chip.message,
    };
  }
  if (chip.source === "verify_outlier") {
    return {
      source: chip.source,
      workspaceId: chip.workspaceId,
      runId: chip.runId,
      capturedAt: chip.capturedAt,
      batchId: chip.batchId,
      scenarioRunId: chip.scenarioRunId,
      messageRefId: chip.messageRefId,
      score: chip.score,
      instability: chip.instability,
      message: chip.message,
    };
  }
  return {
    source: chip.source,
    workspaceId: chip.workspaceId,
    runId: chip.runId,
    capturedAt: chip.capturedAt,
    error: chip.error,
  };
}
