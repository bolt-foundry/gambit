import {
  createIsographEnvironment,
  createIsographStore,
} from "@isograph/react";
import { gambitYoga } from "./simulator_graphql.ts";
import type { GambitID } from "./gambit_id.ts";
import type { GambitWorkspaceRelativePath } from "./gambit_path.ts";
import type { GambitISODateTime } from "./gambit_time.ts";
import type { Maybe } from "./utility_types.ts";

type IsoPreloadsMap = Record<string, unknown>;
type ReadWorkspaceFiles = (args: {
  workspaceId: GambitID;
  id?: Maybe<GambitID>;
  pathPrefix?: Maybe<GambitWorkspaceRelativePath>;
}) => Promise<
  Array<{
    id: GambitID;
    path: GambitWorkspaceRelativePath;
    size: Maybe<number>;
    modifiedAt: Maybe<GambitISODateTime>;
    content: Maybe<string>;
  }>
>;

type BuildRunRecord = {
  id: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  error?: string;
  messages: Array<{
    role: string;
    content: string;
    messageRefId?: string;
  }>;
  traces?: Array<Record<string, unknown>>;
  toolInserts?: Array<{
    actionCallId?: string;
    parentActionCallId?: string;
    name?: string;
    index: number;
  }>;
};

type SessionMetaRecord = {
  id: string;
  deck?: string;
  deckSlug?: string;
  testBotName?: string;
  createdAt?: string;
  sessionDir?: string;
  statePath?: string;
};

type ScenarioRunRecord = {
  id: string;
  workspaceId: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  messages: Array<{
    role: string;
    content: string;
    messageRefId?: string;
  }>;
  traces?: Array<Record<string, unknown>>;
  toolInserts?: Array<{
    actionCallId?: string;
    parentActionCallId?: string;
    name?: string;
    index: number;
  }>;
};

type WorkspaceModelStatusRecord = {
  model: "codex";
  workspaceId: string;
  available: boolean;
  requiresLogin: boolean;
  loggedIn: boolean;
  statusText: string;
  trustedPath?: string;
  writeEnabled: boolean;
};

type GradeRunStatusRecord = "running" | "completed" | "error";

type WorkspaceGradeRunRecord = {
  id: string;
  workspaceId: string;
  scenarioRunId?: string;
  graderId: string;
  graderPath: string;
  graderLabel?: string;
  status: GradeRunStatusRecord;
  runAt?: string;
  error?: string;
  summary?: {
    score?: number;
    reason?: string;
  };
  turns: Array<{
    id: string;
    runId: string;
    turnIndex: number;
    turnNumber: number;
    refId: string;
    score?: number;
    reason?: string;
    priorUser?: string;
    gradedAssistant?: string;
  }>;
};

type WorkspaceGradingFlagRecord = {
  id: string;
  refId: string;
  runId?: string;
  turnIndex?: number;
  reason?: string;
  createdAt: string;
};

type WorkspaceVerifyBatchRequestRecord = {
  id: string;
  status: "queued" | "running" | "completed" | "error";
  runId?: string;
  error?: string;
};

type WorkspaceVerifyBatchRecord = {
  id: string;
  workspaceId: string;
  graderId: string;
  scenarioRunId?: string;
  status: "idle" | "running" | "completed" | "error";
  startedAt?: string;
  finishedAt?: string;
  requested: number;
  active: number;
  completed: number;
  failed: number;
  requests: Array<WorkspaceVerifyBatchRequestRecord>;
};

type WorkspaceConversationSessionKind =
  | "build"
  | "scenario"
  | "grader"
  | "verify";

type WorkspaceConversationSessionRecord = {
  sessionId: string;
  workspaceId: string;
  kind: WorkspaceConversationSessionKind;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  buildRun?: BuildRunRecord;
  scenarioRun?: ScenarioRunRecord;
  gradeRun?: WorkspaceGradeRunRecord;
  verifyBatch?: WorkspaceVerifyBatchRecord;
};

export type SimulatorGraphqlOperations = {
  listWorkspaces: () => Promise<Array<SessionMetaRecord>>;
  createWorkspace: () => Promise<{ workspaceId: string }>;
  deleteWorkspace: (
    workspaceId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  readWorkspaceBuildRun: (workspaceId: string) => Promise<BuildRunRecord>;
  createWorkspaceBuildRun: (
    workspaceId: string,
    message: string,
  ) => Promise<BuildRunRecord>;
  stopWorkspaceBuildRun: (
    workspaceId: string,
    runId: string,
  ) => Promise<BuildRunRecord>;
  resetWorkspaceBuild: (workspaceId: string) => Promise<BuildRunRecord>;
  listWorkspaceScenarioDecks: (
    workspaceId: string,
  ) => Promise<
    Array<{
      id: string;
      label: string;
      description?: string;
      path: string;
      maxTurns?: number;
      inputSchema?: unknown;
      defaults?: unknown;
      inputSchemaError?: string;
    }>
  >;
  readWorkspaceAssistantDeck: (workspaceId: string) => Promise<{
    deck?: string;
    startMode?: "assistant" | "user";
    modelParams?: Record<string, unknown>;
    inputSchema?: unknown;
    defaults?: unknown;
    tools?: Array<{
      name: string;
      label?: string;
      description?: string;
      path?: string;
    }>;
    inputSchemaError?: string;
  }>;
  createWorkspaceScenarioRun: (args: {
    workspaceId: string;
    scenarioDeckId?: Maybe<string>;
    scenarioInput?: unknown;
    assistantInit?: unknown;
  }) => Promise<ScenarioRunRecord>;
  sendWorkspaceScenarioRun: (args: {
    workspaceId: string;
    runId: string;
    message: string;
  }) => Promise<ScenarioRunRecord>;
  stopWorkspaceScenarioRun: (args: {
    workspaceId: string;
    runId: string;
  }) => Promise<ScenarioRunRecord>;
  readWorkspaceScenarioRuns: (
    workspaceId: string,
  ) => Promise<Array<ScenarioRunRecord>>;
  readWorkspaceModelStatus: (args: {
    workspaceId: string;
    model: "codex";
    checkOnline?: boolean;
  }) => Promise<WorkspaceModelStatusRecord>;
  listWorkspaceGraderDecks: (
    workspaceId: string,
  ) => Promise<
    Array<{
      id: string;
      label: string;
      description?: string;
      path: string;
    }>
  >;
  readWorkspaceGradeRuns: (
    workspaceId: string,
  ) => Promise<Array<WorkspaceGradeRunRecord>>;
  readWorkspaceGradingFlags: (
    workspaceId: string,
  ) => Promise<Array<WorkspaceGradingFlagRecord>>;
  createWorkspaceGradeRun: (args: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: Maybe<string>;
  }) => Promise<WorkspaceGradeRunRecord>;
  toggleWorkspaceGradeFlag: (args: {
    workspaceId: string;
    refId: string;
    runId: string;
    turnIndex?: Maybe<number>;
  }) => Promise<Array<WorkspaceGradingFlagRecord>>;
  updateWorkspaceGradeFlagReason: (args: {
    workspaceId: string;
    refId: string;
    reason: string;
  }) => Promise<Array<WorkspaceGradingFlagRecord>>;
  readWorkspaceVerifyBatches: (
    workspaceId: string,
  ) => Promise<Array<WorkspaceVerifyBatchRecord>>;
  createWorkspaceVerifyBatchRun: (args: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: Maybe<string>;
    batchSize: number;
    concurrency: number;
  }) => Promise<WorkspaceVerifyBatchRecord>;
  listWorkspaceConversationSessions: (args: {
    workspaceId: string;
    kind?: Maybe<WorkspaceConversationSessionKind>;
  }) => Promise<Array<WorkspaceConversationSessionRecord>>;
  readWorkspaceConversationSession: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKind;
    sessionId: string;
  }) => Promise<Maybe<WorkspaceConversationSessionRecord>>;
  startWorkspaceConversationSession: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKind;
    sessionId?: Maybe<string>;
    message?: Maybe<string>;
    scenarioDeckId?: Maybe<string>;
    scenarioInput?: unknown;
    assistantInit?: unknown;
    graderId?: Maybe<string>;
    scenarioRunId?: Maybe<string>;
    batchSize?: Maybe<number>;
    concurrency?: Maybe<number>;
  }) => Promise<WorkspaceConversationSessionRecord>;
  sendWorkspaceConversationSession: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKind;
    sessionId: string;
    message: string;
  }) => Promise<WorkspaceConversationSessionRecord>;
  stopWorkspaceConversationSession: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKind;
    sessionId: string;
  }) => Promise<WorkspaceConversationSessionRecord>;
};

function makePreloadKey(queryText: string, variables: unknown): string {
  return `${queryText}::${JSON.stringify(variables ?? null)}`;
}

function extractOperation(opOrText: unknown): {
  queryText?: string;
  operationId?: string;
} {
  if (typeof opOrText === "string") return { queryText: opOrText };
  if (opOrText && typeof opOrText === "object") {
    const maybeWrapper = opOrText as
      & { text?: string; operationId?: string }
      & { operation?: { text?: string; operationId?: string } }
      & {
        networkRequestInfo?: {
          operation?: { text?: string; operationId?: string };
        };
      };
    if (maybeWrapper.text || maybeWrapper.operationId) {
      return {
        queryText: maybeWrapper.text,
        operationId: maybeWrapper.operationId,
      };
    }
    if (maybeWrapper.operation) {
      return {
        queryText: maybeWrapper.operation.text,
        operationId: maybeWrapper.operation.operationId,
      };
    }
    if (maybeWrapper.networkRequestInfo?.operation) {
      return {
        queryText: maybeWrapper.networkRequestInfo.operation.text,
        operationId: maybeWrapper.networkRequestInfo.operation.operationId,
      };
    }
  }
  return {};
}

export function getSimulatorIsographEnvironment(
  readWorkspaceFiles?: ReadWorkspaceFiles,
  operations?: SimulatorGraphqlOperations,
) {
  const store = createIsographStore();
  const preloads: IsoPreloadsMap = {};

  async function networkRequestWrapper<T>(
    opOrText: unknown,
    variables: unknown,
    maybeInfo?: unknown,
  ): Promise<T> {
    const primary = extractOperation(opOrText);
    const fallback = extractOperation(maybeInfo);
    const queryText = primary.queryText ?? fallback.queryText;
    const operationId = primary.operationId ?? fallback.operationId;
    const query = queryText ?? (typeof opOrText === "string" ? opOrText : "");

    if (!query && operationId) {
      throw new Error(
        "Persisted operations are not supported by the current /graphql endpoint.",
      );
    }

    const response = await gambitYoga.fetch(
      new URL("http://localhost/graphql"),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      },
      {
        readWorkspaceFiles: readWorkspaceFiles ??
          (() => Promise.resolve([])),
        listWorkspaces: operations?.listWorkspaces ??
          (() => Promise.resolve([])),
        createWorkspace: operations?.createWorkspace ??
          (() => Promise.resolve({ workspaceId: "" })),
        deleteWorkspace: operations?.deleteWorkspace ??
          (() => Promise.resolve({ ok: false, error: "not_configured" })),
        readWorkspaceBuildRun: operations?.readWorkspaceBuildRun ??
          ((workspaceId: string) =>
            Promise.resolve({
              id: workspaceId,
              status: "idle",
              messages: [],
              traces: [],
              toolInserts: [],
            })),
        createWorkspaceBuildRun: operations?.createWorkspaceBuildRun ??
          ((workspaceId: string) =>
            Promise.resolve({
              id: workspaceId,
              status: "idle",
              messages: [],
              traces: [],
              toolInserts: [],
            })),
        stopWorkspaceBuildRun: operations?.stopWorkspaceBuildRun ??
          ((workspaceId: string) =>
            Promise.resolve({
              id: workspaceId,
              status: "idle",
              messages: [],
              traces: [],
              toolInserts: [],
            })),
        resetWorkspaceBuild: operations?.resetWorkspaceBuild ??
          ((workspaceId: string) =>
            Promise.resolve({
              id: workspaceId,
              status: "idle",
              messages: [],
              traces: [],
              toolInserts: [],
            })),
        listWorkspaceScenarioDecks: operations?.listWorkspaceScenarioDecks ??
          (() => Promise.resolve([])),
        readWorkspaceAssistantDeck: operations?.readWorkspaceAssistantDeck ??
          (() => Promise.resolve({})),
        createWorkspaceScenarioRun: operations?.createWorkspaceScenarioRun ??
          ((args: { workspaceId: string }) =>
            Promise.resolve({
              id: args.workspaceId,
              workspaceId: args.workspaceId,
              status: "idle",
              error: undefined,
              messages: [],
              traces: [],
              toolInserts: [],
            })),
        sendWorkspaceScenarioRun: operations?.sendWorkspaceScenarioRun ??
          ((args: { workspaceId: string; runId: string }) =>
            Promise.resolve({
              id: args.runId,
              workspaceId: args.workspaceId,
              status: "idle",
              error: undefined,
              messages: [],
              traces: [],
              toolInserts: [],
            })),
        stopWorkspaceScenarioRun: operations?.stopWorkspaceScenarioRun ??
          ((args: { workspaceId: string; runId: string }) =>
            Promise.resolve({
              id: args.runId,
              workspaceId: args.workspaceId,
              status: "idle",
              error: undefined,
              messages: [],
              traces: [],
              toolInserts: [],
            })),
        readWorkspaceScenarioRuns: operations?.readWorkspaceScenarioRuns ??
          (() => Promise.resolve([])),
        readWorkspaceModelStatus: operations?.readWorkspaceModelStatus ??
          ((args: { workspaceId: string; model: "codex" }) =>
            Promise.resolve({
              model: args.model,
              workspaceId: args.workspaceId,
              available: false,
              requiresLogin: true,
              loggedIn: false,
              statusText: "Model status resolver is unavailable.",
              writeEnabled: false,
            })),
        listWorkspaceGraderDecks: operations?.listWorkspaceGraderDecks ??
          (() => Promise.resolve([])),
        readWorkspaceGradeRuns: operations?.readWorkspaceGradeRuns ??
          (() => Promise.resolve([])),
        readWorkspaceGradingFlags: operations?.readWorkspaceGradingFlags ??
          (() => Promise.resolve([])),
        createWorkspaceGradeRun: operations?.createWorkspaceGradeRun ??
          ((args: { workspaceId: string; graderId: string }) =>
            Promise.resolve({
              id: `${args.workspaceId}:grade`,
              workspaceId: args.workspaceId,
              graderId: args.graderId,
              graderPath: args.graderId,
              graderLabel: args.graderId,
              status: "error",
              error: "grade_run_create_unavailable",
              turns: [],
            })),
        toggleWorkspaceGradeFlag: operations?.toggleWorkspaceGradeFlag ??
          (() => Promise.resolve([])),
        updateWorkspaceGradeFlagReason:
          operations?.updateWorkspaceGradeFlagReason ??
            (() => Promise.resolve([])),
        readWorkspaceVerifyBatches: operations?.readWorkspaceVerifyBatches ??
          (() => Promise.resolve([])),
        createWorkspaceVerifyBatchRun:
          operations?.createWorkspaceVerifyBatchRun ??
            ((args: {
              workspaceId: string;
              graderId: string;
              scenarioRunId?: Maybe<string>;
              batchSize: number;
              concurrency: number;
            }) =>
              Promise.resolve({
                id: `${args.workspaceId}:verify-batch`,
                workspaceId: args.workspaceId,
                graderId: args.graderId,
                status: "error",
                requested: 0,
                active: 0,
                completed: 0,
                failed: 0,
                requests: [{
                  id: `${args.workspaceId}:verify-batch:request:1`,
                  status: "error",
                  error: "verify_batch_run_create_unavailable",
                }],
              })),
        listWorkspaceConversationSessions:
          operations?.listWorkspaceConversationSessions ??
            ((args: { workspaceId: string }) =>
              Promise.resolve([{
                sessionId: args.workspaceId,
                workspaceId: args.workspaceId,
                kind: "build" as const,
                status: "idle" as const,
              }])),
        readWorkspaceConversationSession:
          operations?.readWorkspaceConversationSession ??
            ((args: {
              workspaceId: string;
              kind: WorkspaceConversationSessionKind;
              sessionId: string;
            }) =>
              Promise.resolve({
                sessionId: args.sessionId,
                workspaceId: args.workspaceId,
                kind: args.kind,
                status: "idle" as const,
              })),
        startWorkspaceConversationSession:
          operations?.startWorkspaceConversationSession ??
            ((args: {
              workspaceId: string;
              kind: WorkspaceConversationSessionKind;
            }) =>
              Promise.resolve({
                sessionId: args.workspaceId,
                workspaceId: args.workspaceId,
                kind: args.kind,
                status: "idle" as const,
              })),
        sendWorkspaceConversationSession:
          operations?.sendWorkspaceConversationSession ??
            ((args: {
              workspaceId: string;
              kind: WorkspaceConversationSessionKind;
              sessionId: string;
              message: string;
            }) =>
              Promise.resolve({
                sessionId: args.sessionId,
                workspaceId: args.workspaceId,
                kind: args.kind,
                status: args.message.trim().length > 0 ? "running" : "idle",
              })),
        stopWorkspaceConversationSession:
          operations?.stopWorkspaceConversationSession ??
            ((args: {
              workspaceId: string;
              kind: WorkspaceConversationSessionKind;
              sessionId: string;
            }) =>
              Promise.resolve({
                sessionId: args.sessionId,
                workspaceId: args.workspaceId,
                kind: args.kind,
                status: "canceled" as const,
              })),
      },
    );

    const json = await response.json().catch(() => ({}));

    try {
      if (query) {
        preloads[makePreloadKey(query, variables)] = json;
      }
    } catch {
      // Best effort preload capture; do not block server rendering.
    }

    if (!response.ok) {
      throw new Error("NetworkError", { cause: json });
    }

    if (
      json && typeof json === "object" &&
      Array.isArray((json as { errors?: unknown }).errors) &&
      (json as { errors: Array<unknown> }).errors.length > 0
    ) {
      const errors = (json as { errors: Array<{ message?: string }> }).errors;
      throw new Error(errors[0]?.message ?? "GraphQL operation failed", {
        cause: {
          query,
          variables,
          errors,
        },
      });
    }

    return json as T;
  }

  const environment = createIsographEnvironment(
    store,
    networkRequestWrapper,
    undefined,
  );
  return { environment, preloads };
}
