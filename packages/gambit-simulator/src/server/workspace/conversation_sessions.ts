import type {
  BuildBotRunStatus,
  TestBotRunStatus,
  WorkspaceConversationSessionKindForGraphql,
  WorkspaceConversationSessionRecordForGraphql,
  WorkspaceGradeRunForGraphql,
  WorkspaceVerifyBatchRecordForGraphql,
} from "./types.ts";

const toBuildConversationSessionForGraphql = (
  workspaceId: string,
  run: BuildBotRunStatus,
): WorkspaceConversationSessionRecordForGraphql => ({
  sessionId: run.id,
  workspaceId,
  kind: "build",
  status: run.status,
  error: run.error,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  buildRun: run,
});

const toScenarioConversationSessionForGraphql = (
  workspaceId: string,
  run: TestBotRunStatus,
): WorkspaceConversationSessionRecordForGraphql => ({
  sessionId: run.id,
  workspaceId,
  kind: "scenario",
  status: run.status,
  error: run.error,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  scenarioRun: run,
});

const toGraderConversationSessionForGraphql = (
  workspaceId: string,
  run: WorkspaceGradeRunForGraphql,
): WorkspaceConversationSessionRecordForGraphql => ({
  sessionId: run.id,
  workspaceId,
  kind: "grader",
  status: run.status,
  error: run.error,
  startedAt: run.runAt,
  finishedAt: run.runAt,
  gradeRun: run,
});

const toVerifyConversationSessionForGraphql = (
  workspaceId: string,
  batch: WorkspaceVerifyBatchRecordForGraphql,
): WorkspaceConversationSessionRecordForGraphql => ({
  sessionId: batch.id,
  workspaceId,
  kind: "verify",
  status: batch.status,
  startedAt: batch.startedAt,
  finishedAt: batch.finishedAt,
  verifyBatch: batch,
});

export const createWorkspaceConversationSessionService = (deps: {
  readWorkspaceBuildRunForGraphql: (workspaceId: string) => BuildBotRunStatus;
  startWorkspaceBuildRun: (args: {
    workspaceId: string;
    message: string;
  }) => BuildBotRunStatus;
  stopWorkspaceBuildRun: (args: {
    workspaceId: string;
    runId: string;
  }) => Promise<BuildBotRunStatus>;
  startWorkspaceScenarioRunForGraphql: (args: {
    workspaceId: string;
    runId?: string;
    scenarioDeckId?: string | null;
    scenarioInput?: unknown;
    assistantInit?: unknown;
  }) => Promise<TestBotRunStatus>;
  sendWorkspaceScenarioRunForGraphql: (args: {
    workspaceId: string;
    runId: string;
    message: string;
  }) => Promise<TestBotRunStatus>;
  stopWorkspaceScenarioRunForGraphql: (args: {
    workspaceId: string;
    runId: string;
  }) => Promise<TestBotRunStatus>;
  readWorkspaceScenarioRunsForGraphql: (
    workspaceId: string,
  ) => Array<TestBotRunStatus>;
  readWorkspaceGradeRunsForGraphql: (
    workspaceId: string,
  ) => Array<WorkspaceGradeRunForGraphql>;
  createWorkspaceGradeRunForGraphql: (args: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: string | null;
  }) => Promise<WorkspaceGradeRunForGraphql>;
  readWorkspaceVerifyBatchesForGraphql: (
    workspaceId: string,
  ) => Array<WorkspaceVerifyBatchRecordForGraphql>;
  createWorkspaceVerifyBatchRunForGraphql: (args: {
    workspaceId: string;
    scenarioDeckId?: string | null;
    graderId: string;
    scenarioRuns: number;
    graderRepeatsPerScenario: number;
    concurrency: number;
  }) => Promise<WorkspaceVerifyBatchRecordForGraphql>;
  defaultVerifyScenarioRuns: number;
  defaultVerifyGraderRepeats: number;
  defaultVerifyConcurrency: number;
}) => {
  const listWorkspaceConversationSessionsForGraphql = (args: {
    workspaceId: string;
    kind?: WorkspaceConversationSessionKindForGraphql | null;
  }): Promise<Array<WorkspaceConversationSessionRecordForGraphql>> => {
    const sessions: Array<WorkspaceConversationSessionRecordForGraphql> = [];
    if (!args.kind || args.kind === "build") {
      sessions.push(
        toBuildConversationSessionForGraphql(
          args.workspaceId,
          deps.readWorkspaceBuildRunForGraphql(args.workspaceId),
        ),
      );
    }
    if (!args.kind || args.kind === "scenario") {
      for (
        const run of deps.readWorkspaceScenarioRunsForGraphql(args.workspaceId)
      ) {
        sessions.push(
          toScenarioConversationSessionForGraphql(args.workspaceId, run),
        );
      }
    }
    if (!args.kind || args.kind === "grader") {
      for (
        const run of deps.readWorkspaceGradeRunsForGraphql(args.workspaceId)
      ) {
        sessions.push(
          toGraderConversationSessionForGraphql(args.workspaceId, run),
        );
      }
    }
    if (!args.kind || args.kind === "verify") {
      for (
        const batch of deps.readWorkspaceVerifyBatchesForGraphql(
          args.workspaceId,
        )
      ) {
        sessions.push(
          toVerifyConversationSessionForGraphql(args.workspaceId, batch),
        );
      }
    }
    sessions.sort((left, right) => {
      const leftKey = left.finishedAt ?? left.startedAt ?? left.sessionId;
      const rightKey = right.finishedAt ?? right.startedAt ?? right.sessionId;
      return rightKey.localeCompare(leftKey);
    });
    return Promise.resolve(sessions);
  };

  const readWorkspaceConversationSessionForGraphql = async (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKindForGraphql;
    sessionId: string;
  }): Promise<WorkspaceConversationSessionRecordForGraphql | null> => {
    const sessions = await listWorkspaceConversationSessionsForGraphql({
      workspaceId: args.workspaceId,
      kind: args.kind,
    });
    return sessions.find((session) => session.sessionId === args.sessionId) ??
      null;
  };

  const startWorkspaceConversationSessionForGraphql = async (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKindForGraphql;
    sessionId?: string | null;
    message?: string | null;
    scenarioDeckId?: string | null;
    scenarioInput?: unknown;
    assistantInit?: unknown;
    graderId?: string | null;
    scenarioRunId?: string | null;
    scenarioRuns?: number | null;
    graderRepeatsPerScenario?: number | null;
    concurrency?: number | null;
  }): Promise<WorkspaceConversationSessionRecordForGraphql> => {
    if (args.kind === "build") {
      const run = await deps.startWorkspaceBuildRun({
        workspaceId: args.workspaceId,
        message: args.message ?? "",
      });
      return toBuildConversationSessionForGraphql(args.workspaceId, run);
    }
    if (args.kind === "scenario") {
      const run = await deps.startWorkspaceScenarioRunForGraphql({
        workspaceId: args.workspaceId,
        runId: args.sessionId ?? undefined,
        scenarioDeckId: args.scenarioDeckId ?? null,
        scenarioInput: args.scenarioInput,
        assistantInit: args.assistantInit,
      });
      return toScenarioConversationSessionForGraphql(args.workspaceId, run);
    }
    if (args.kind === "grader") {
      if (!args.graderId) throw new Error("graderId is required");
      const run = await deps.createWorkspaceGradeRunForGraphql({
        workspaceId: args.workspaceId,
        graderId: args.graderId,
        scenarioRunId: args.scenarioRunId ?? null,
      });
      return toGraderConversationSessionForGraphql(args.workspaceId, run);
    }
    if (!args.graderId) throw new Error("graderId is required");
    const batch = await deps.createWorkspaceVerifyBatchRunForGraphql({
      workspaceId: args.workspaceId,
      scenarioDeckId: args.scenarioDeckId ?? null,
      graderId: args.graderId,
      scenarioRuns: args.scenarioRuns ?? deps.defaultVerifyScenarioRuns,
      graderRepeatsPerScenario: args.graderRepeatsPerScenario ??
        deps.defaultVerifyGraderRepeats,
      concurrency: args.concurrency ?? deps.defaultVerifyConcurrency,
    });
    return toVerifyConversationSessionForGraphql(args.workspaceId, batch);
  };

  const sendWorkspaceConversationSessionForGraphql = async (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKindForGraphql;
    sessionId: string;
    message: string;
  }): Promise<WorkspaceConversationSessionRecordForGraphql> => {
    if (args.kind === "build") {
      const run = await deps.startWorkspaceBuildRun({
        workspaceId: args.workspaceId,
        message: args.message,
      });
      return toBuildConversationSessionForGraphql(args.workspaceId, run);
    }
    if (args.kind !== "scenario") {
      throw new Error(`Send is unavailable for ${args.kind} sessions`);
    }
    const run = await deps.sendWorkspaceScenarioRunForGraphql({
      workspaceId: args.workspaceId,
      runId: args.sessionId,
      message: args.message,
    });
    return toScenarioConversationSessionForGraphql(args.workspaceId, run);
  };

  const stopWorkspaceConversationSessionForGraphql = async (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKindForGraphql;
    sessionId: string;
  }): Promise<WorkspaceConversationSessionRecordForGraphql> => {
    if (args.kind === "build") {
      const run = await deps.stopWorkspaceBuildRun({
        workspaceId: args.workspaceId,
        runId: args.sessionId,
      });
      return toBuildConversationSessionForGraphql(args.workspaceId, run);
    }
    if (args.kind !== "scenario") {
      const existing = await readWorkspaceConversationSessionForGraphql(args);
      if (!existing) {
        throw new Error(`Conversation session ${args.sessionId} not found`);
      }
      return existing;
    }
    const run = await deps.stopWorkspaceScenarioRunForGraphql({
      workspaceId: args.workspaceId,
      runId: args.sessionId,
    });
    return toScenarioConversationSessionForGraphql(args.workspaceId, run);
  };

  return {
    listWorkspaceConversationSessionsForGraphql,
    readWorkspaceConversationSessionForGraphql,
    startWorkspaceConversationSessionForGraphql,
    sendWorkspaceConversationSessionForGraphql,
    stopWorkspaceConversationSessionForGraphql,
  };
};
