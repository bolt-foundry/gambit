import SchemaBuilder from "@pothos/core";
import RelayPlugin, { resolveArrayConnection } from "@pothos/plugin-relay";
import { createYoga } from "graphql-yoga";
import { Kind, type ValueNode } from "graphql";
import {
  asGambitID,
  asGambitStreamID,
  type GambitID,
  type GambitStreamID,
} from "./gambit_id.ts";
import {
  asGambitWorkspaceRelativePath,
  type GambitWorkspaceRelativePath,
} from "./gambit_path.ts";
import { asGambitISODateTime, type GambitISODateTime } from "./gambit_time.ts";
import type { Maybe } from "./utility_types.ts";
import {
  getDurableStreamNextOffset,
  readDurableStreamEvents,
  subscribeDurableStream,
} from "./durable_streams.ts";

const BUILD_CHAT_DEBUG = (() => {
  const value = (Deno.env.get("GAMBIT_BUILD_CHAT_DEBUG") ?? "").toLowerCase()
    .trim();
  return value === "1" || value === "true" || value === "yes";
})();

function logBuildChatDebug(
  event: string,
  payload: Record<string, unknown>,
): void {
  if (!BUILD_CHAT_DEBUG) return;
  // deno-lint-ignore no-console -- debug logging is gated by env var.
  console.log(`[gambit-build-chat-debug] ${event} ${JSON.stringify(payload)}`);
}

type StreamEventRecord = {
  offset: number;
  createdAt: GambitISODateTime;
  type: string;
  data: unknown;
};

type StreamReplayRecord = {
  streamId: GambitStreamID;
  fromOffset: number;
  nextOffset: number;
  events: Array<StreamEventRecord>;
};

type WorkspaceRecord = {
  id: GambitID;
};

type WorkspaceFileRecord = {
  id: GambitID;
  path: GambitWorkspaceRelativePath;
  size: Maybe<number>;
  modifiedAt: Maybe<GambitISODateTime>;
  content: Maybe<string>;
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

type BuildRunRecord = {
  id: string;
  workspaceId?: string;
  conversationRunKind?: "build" | "scenario";
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

type BuildStateRecord = {
  workspaceId: string;
  run: BuildRunRecord;
};

type ScenarioDeckRecord = {
  id: string;
  label: string;
  description?: string;
  path: string;
  maxTurns?: number;
  inputSchema?: unknown;
  defaults?: unknown;
  inputSchemaError?: string;
};

type WorkspaceAssistantDeckRecord = {
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
};

type ScenarioRunRecord = {
  id: string;
  workspaceId: string;
  conversationRunKind?: "scenario";
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

type WorkspaceModelsRecord = {
  workspaceId: string;
};

type WorkspaceGraderDeckRecord = {
  id: string;
  label: string;
  description?: string;
  path: string;
};

type WorkspaceGradeTurnRecord = {
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

type WorkspaceGradeRunRecord = {
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
  turns: Array<WorkspaceGradeTurnRecord>;
};

type WorkspaceGradeFlagRecord = {
  id: string;
  refId: string;
  runId?: string;
  turnIndex?: number;
  reason?: string;
  createdAt: string;
};

type WorkspaceGradeTabRecord = {
  workspaceId: string;
};

type WorkspaceVerificationRecord = {
  workspaceId: string;
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

type WorkspaceVerifyOutlierRecord = {
  key: string;
  label: string;
  sampleSize: number;
  agreementRate: Maybe<number>;
  scoreDelta: Maybe<number>;
  passFlip: boolean;
  instability: boolean;
  minRunId?: string;
  maxRunId?: string;
  turnIndex?: number;
  messageRefId?: string;
};

type WorkspaceVerifyMetricsRecord = {
  sampleSize: number;
  agreementRate: Maybe<number>;
  scoreSpreadMin: Maybe<number>;
  scoreSpreadMedian: Maybe<number>;
  scoreSpreadMax: Maybe<number>;
  instabilityCount: number;
  verdict: "PASS" | "WARN" | "FAIL";
  verdictReason: string;
  outliers: Array<WorkspaceVerifyOutlierRecord>;
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

type OutputMessageRecord = {
  __typename: "OutputMessage";
  id: string;
  role: string;
  content: string;
  messageRefId?: string;
};

type OutputReasoningRecord = {
  __typename: "OutputReasoning";
  id: string;
  summary: string;
  reasoningType?: string;
};

type OutputToolCallRecord = {
  __typename: "OutputToolCall";
  id: string;
  toolCallId: string;
  toolName: string;
  status: "RUNNING" | "COMPLETED" | "ERROR";
  argumentsText?: string;
  resultText?: string;
  error?: string;
};

type OpenResponseOutputItemRecord =
  | OutputMessageRecord
  | OutputReasoningRecord
  | OutputToolCallRecord;

export type GambitGraphqlContext = {
  readWorkspaceFiles: (args: {
    workspaceId: GambitID;
    id?: Maybe<GambitID>;
    pathPrefix?: Maybe<GambitWorkspaceRelativePath>;
  }) => Promise<Array<WorkspaceFileRecord>>;
  listWorkspaces?: () => Promise<Array<SessionMetaRecord>>;
  createWorkspace?: () => Promise<{ workspaceId: string }>;
  deleteWorkspace?: (
    workspaceId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  readWorkspaceBuildRun?: (workspaceId: string) => Promise<BuildRunRecord>;
  createWorkspaceBuildRun?: (
    workspaceId: string,
    message: string,
  ) => Promise<BuildRunRecord>;
  stopWorkspaceBuildRun?: (
    workspaceId: string,
    runId: string,
  ) => Promise<BuildRunRecord>;
  resetWorkspaceBuild?: (workspaceId: string) => Promise<BuildRunRecord>;
  listWorkspaceScenarioDecks?: (
    workspaceId: string,
  ) => Promise<Array<ScenarioDeckRecord>>;
  readWorkspaceAssistantDeck?: (
    workspaceId: string,
  ) => Promise<WorkspaceAssistantDeckRecord>;
  createWorkspaceScenarioRun?: (args: {
    workspaceId: string;
    scenarioDeckId?: Maybe<string>;
    scenarioInput?: unknown;
    assistantInit?: unknown;
  }) => Promise<ScenarioRunRecord>;
  sendWorkspaceScenarioRun?: (args: {
    workspaceId: string;
    runId: string;
    message: string;
  }) => Promise<ScenarioRunRecord>;
  stopWorkspaceScenarioRun?: (args: {
    workspaceId: string;
    runId: string;
  }) => Promise<ScenarioRunRecord>;
  readWorkspaceScenarioRuns?: (
    workspaceId: string,
  ) => Promise<Array<ScenarioRunRecord>>;
  readWorkspaceModelStatus?: (args: {
    workspaceId: string;
    model: "codex";
    checkOnline?: boolean;
  }) => Promise<WorkspaceModelStatusRecord>;
  listWorkspaceGraderDecks?: (
    workspaceId: string,
  ) => Promise<Array<WorkspaceGraderDeckRecord>>;
  readWorkspaceGradeRuns?: (
    workspaceId: string,
  ) => Promise<Array<WorkspaceGradeRunRecord>>;
  readWorkspaceGradingFlags?: (
    workspaceId: string,
  ) => Promise<Array<WorkspaceGradeFlagRecord>>;
  createWorkspaceGradeRun?: (args: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: Maybe<string>;
  }) => Promise<WorkspaceGradeRunRecord>;
  toggleWorkspaceGradeFlag?: (args: {
    workspaceId: string;
    refId: string;
    runId: string;
    turnIndex?: Maybe<number>;
  }) => Promise<Array<WorkspaceGradeFlagRecord>>;
  updateWorkspaceGradeFlagReason?: (args: {
    workspaceId: string;
    refId: string;
    reason: string;
  }) => Promise<Array<WorkspaceGradeFlagRecord>>;
  readWorkspaceVerifyBatches?: (
    workspaceId: string,
  ) => Promise<Array<WorkspaceVerifyBatchRecord>>;
  createWorkspaceVerifyBatchRun?: (args: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: Maybe<string>;
    batchSize: number;
    concurrency: number;
  }) => Promise<WorkspaceVerifyBatchRecord>;
  listWorkspaceConversationSessions?: (args: {
    workspaceId: string;
    kind?: Maybe<WorkspaceConversationSessionKind>;
  }) => Promise<Array<WorkspaceConversationSessionRecord>>;
  readWorkspaceConversationSession?: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKind;
    sessionId: string;
  }) => Promise<Maybe<WorkspaceConversationSessionRecord>>;
  startWorkspaceConversationSession?: (args: {
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
  sendWorkspaceConversationSession?: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKind;
    sessionId: string;
    message: string;
  }) => Promise<WorkspaceConversationSessionRecord>;
  stopWorkspaceConversationSession?: (args: {
    workspaceId: string;
    kind: WorkspaceConversationSessionKind;
    sessionId: string;
  }) => Promise<WorkspaceConversationSessionRecord>;
};

const builder = new SchemaBuilder<{
  Context: GambitGraphqlContext;
  Scalars: {
    JSON: {
      Input: unknown;
      Output: unknown;
    };
    WorkspaceRelativePath: {
      Input: GambitWorkspaceRelativePath;
      Output: GambitWorkspaceRelativePath;
    };
  };
}>({
  plugins: [RelayPlugin],
  relay: {},
});

const WorkspaceRelativePathScalar = builder.scalarType(
  "WorkspaceRelativePath",
  {
    serialize: (value) => {
      if (typeof value !== "string") {
        throw new Error("WorkspaceRelativePath must serialize as string.");
      }
      return value;
    },
    parseValue: (value) => {
      if (typeof value !== "string") {
        throw new Error("WorkspaceRelativePath must be a string.");
      }
      return asGambitWorkspaceRelativePath(value);
    },
    parseLiteral: (ast) => {
      if (ast.kind !== Kind.STRING) {
        throw new Error("WorkspaceRelativePath must be a string literal.");
      }
      return asGambitWorkspaceRelativePath(ast.value);
    },
  },
);

function parseJsonLiteral(ast: ValueNode): unknown {
  switch (ast.kind) {
    case Kind.NULL:
      return null;
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.LIST:
      return ast.values.map(parseJsonLiteral);
    case Kind.OBJECT: {
      const result: Record<string, unknown> = {};
      for (const field of ast.fields) {
        result[field.name.value] = parseJsonLiteral(field.value);
      }
      return result;
    }
    default:
      return null;
  }
}

builder.scalarType("JSON", {
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: parseJsonLiteral,
});

const OpenResponseStatusEnum = builder.enumType("OpenResponseStatus", {
  values: ["IDLE", "RUNNING", "COMPLETED", "FAILED", "CANCELED"] as const,
});

function toOpenResponseStatus(
  value: BuildRunRecord["status"],
): "IDLE" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED" {
  switch (value) {
    case "running":
      return "RUNNING";
    case "completed":
      return "COMPLETED";
    case "error":
      return "FAILED";
    case "canceled":
      return "CANCELED";
    default:
      return "IDLE";
  }
}

function parseWorkspaceConversationSessionKind(
  value: string,
): WorkspaceConversationSessionKind {
  if (
    value === "build" || value === "scenario" || value === "grader" ||
    value === "verify"
  ) {
    return value;
  }
  throw new Error(`Unsupported conversation session kind: ${value}`);
}

function isWorkspaceConversationSessionRecord(
  value: unknown,
): value is WorkspaceConversationSessionRecord {
  return !!value && typeof value === "object" &&
    typeof (value as { kind?: unknown }).kind === "string";
}

function materializeOpenResponseOutputItems(
  run: BuildRunRecord,
): Array<OpenResponseOutputItemRecord> {
  const materialized = run.messages.flatMap<OpenResponseOutputItemRecord>((
    message,
    index,
  ) => {
    const content = typeof message.content === "string" ? message.content : "";
    if (!content.trim()) return [];
    return [{
      __typename: "OutputMessage",
      id: `${run.id}:item:${index}`,
      role: message.role,
      content,
      messageRefId: message.messageRefId,
    }];
  });
  logBuildChatDebug("materialize.outputItems", {
    runId: run.id,
    messageCount: run.messages.length,
    outputCount: materialized.length,
  });
  return materialized;
}

const WorkspaceSessionMetaType = builder.objectRef<SessionMetaRecord>(
  "WorkspaceSessionMeta",
);
WorkspaceSessionMetaType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    deck: t.string({
      nullable: true,
      resolve: (parent) => parent.deck ?? null,
    }),
    deckSlug: t.string({
      nullable: true,
      resolve: (parent) => parent.deckSlug ?? null,
    }),
    testBotName: t.string({
      nullable: true,
      resolve: (parent) => parent.testBotName ?? null,
    }),
    createdAt: t.string({
      nullable: true,
      resolve: (parent) => parent.createdAt ?? null,
    }),
    sessionDir: t.string({
      nullable: true,
      resolve: (parent) => parent.sessionDir ?? null,
    }),
    statePath: t.string({
      nullable: true,
      resolve: (parent) => parent.statePath ?? null,
    }),
  }),
});

const WorkspaceDeletePayloadType = builder.objectRef<{
  workspaceId: string;
  deleted: boolean;
  error?: string;
}>("WorkspaceDeletePayload");
WorkspaceDeletePayloadType.implement({
  fields: (t) => ({
    workspaceId: t.id({ resolve: (parent) => parent.workspaceId }),
    deleted: t.boolean({ resolve: (parent) => parent.deleted }),
    error: t.string({
      nullable: true,
      resolve: (parent) => parent.error ?? null,
    }),
  }),
});

const StreamEventType = builder.objectRef<StreamEventRecord>(
  "GambitDurableStreamEvent",
);
StreamEventType.implement({
  fields: (t) => ({
    offset: t.int({ resolve: (parent) => parent.offset }),
    createdAt: t.string({ resolve: (parent) => parent.createdAt }),
    type: t.string({ resolve: (parent) => parent.type }),
    data: t.field({ type: "JSON", resolve: (parent) => parent.data }),
  }),
});

const StreamReplayType = builder.objectRef<StreamReplayRecord>(
  "GambitDurableStreamReplay",
);
StreamReplayType.implement({
  fields: (t) => ({
    streamId: t.id({ resolve: (parent) => parent.streamId }),
    fromOffset: t.int({ resolve: (parent) => parent.fromOffset }),
    nextOffset: t.int({ resolve: (parent) => parent.nextOffset }),
    events: t.field({
      type: [StreamEventType],
      resolve: (parent) => parent.events,
    }),
  }),
});

const WorkspaceFileType = builder.objectRef<WorkspaceFileRecord>(
  "WorkspaceFile",
);
WorkspaceFileType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    path: t.field({
      type: WorkspaceRelativePathScalar,
      resolve: (parent) => parent.path,
    }),
    size: t.int({
      nullable: true,
      resolve: (parent) => parent.size,
    }),
    modifiedAt: t.string({
      nullable: true,
      resolve: (parent) => parent.modifiedAt,
    }),
    content: t.string({
      nullable: true,
      resolve: (parent) => parent.content,
    }),
  }),
});

const WorkspaceScenarioDeckType = builder.objectRef<ScenarioDeckRecord>(
  "WorkspaceScenarioDeck",
);
WorkspaceScenarioDeckType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    label: t.string({ resolve: (parent) => parent.label }),
    description: t.string({
      nullable: true,
      resolve: (parent) => parent.description ?? null,
    }),
    path: t.string({ resolve: (parent) => parent.path }),
    maxTurns: t.int({
      nullable: true,
      resolve: (parent) => parent.maxTurns ?? null,
    }),
    inputSchema: t.field({
      type: "String",
      nullable: true,
      resolve: (parent) =>
        parent.inputSchema ? JSON.stringify(parent.inputSchema) : null,
    }),
    defaults: t.field({
      type: "String",
      nullable: true,
      resolve: (parent) =>
        parent.defaults !== undefined ? JSON.stringify(parent.defaults) : null,
    }),
    inputSchemaError: t.string({
      nullable: true,
      resolve: (parent) => parent.inputSchemaError ?? null,
    }),
  }),
});

const WorkspaceAssistantDeckType = builder.objectRef<
  WorkspaceAssistantDeckRecord
>(
  "WorkspaceAssistantDeck",
);
WorkspaceAssistantDeckType.implement({
  fields: (t) => ({
    deck: t.string({
      nullable: true,
      resolve: (parent) => parent.deck ?? null,
    }),
    startMode: t.string({
      nullable: true,
      resolve: (parent) => parent.startMode ?? null,
    }),
    modelParams: t.field({
      type: "String",
      nullable: true,
      resolve: (parent) =>
        parent.modelParams ? JSON.stringify(parent.modelParams) : null,
    }),
    inputSchema: t.field({
      type: "String",
      nullable: true,
      resolve: (parent) =>
        parent.inputSchema ? JSON.stringify(parent.inputSchema) : null,
    }),
    defaults: t.field({
      type: "String",
      nullable: true,
      resolve: (parent) =>
        parent.defaults !== undefined ? JSON.stringify(parent.defaults) : null,
    }),
    tools: t.field({
      type: "String",
      nullable: true,
      resolve: (parent) => parent.tools ? JSON.stringify(parent.tools) : null,
    }),
    inputSchemaError: t.string({
      nullable: true,
      resolve: (parent) => parent.inputSchemaError ?? null,
    }),
  }),
});

const WorkspaceRunInterface = builder.interfaceRef<BuildRunRecord>(
  "WorkspaceRun",
);
WorkspaceRunInterface.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    workspaceId: t.id({
      resolve: (parent) =>
        asGambitID(
          typeof parent.workspaceId === "string" &&
            parent.workspaceId.length > 0
            ? parent.workspaceId
            : parent.id,
        ),
    }),
    status: t.field({
      type: OpenResponseStatusEnum,
      resolve: (parent) => toOpenResponseStatus(parent.status),
    }),
  }),
});

const WorkspaceConversationRunInterface = builder.interfaceRef<
  BuildRunRecord | ScenarioRunRecord
>("WorkspaceConversationRun");
WorkspaceConversationRunInterface.implement({
  resolveType: (parent) =>
    parent.conversationRunKind === "scenario"
      ? "WorkspaceScenarioRun"
      : "WorkspaceBuildRun",
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    workspaceId: t.id({
      resolve: (parent) =>
        asGambitID(
          "workspaceId" in parent && typeof parent.workspaceId === "string"
            ? parent.workspaceId
            : parent.id,
        ),
    }),
    status: t.field({
      type: OpenResponseStatusEnum,
      resolve: (parent) => toOpenResponseStatus(parent.status),
    }),
    error: t.string({
      nullable: true,
      resolve: (parent) => parent.error ?? null,
    }),
    startedAt: t.string({
      nullable: true,
      resolve: (parent) => parent.startedAt ?? null,
    }),
    finishedAt: t.string({
      nullable: true,
      resolve: (parent) => parent.finishedAt ?? null,
    }),
    openResponses: t.connection({
      type: OpenResponseType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: (parent, args) =>
        resolveArrayConnection({ args }, [parent as BuildRunRecord]),
    }),
  }),
});

const WorkspaceScenarioRunType = builder.objectRef<ScenarioRunRecord>(
  "WorkspaceScenarioRun",
);
WorkspaceScenarioRunType.implement({
  interfaces: [WorkspaceConversationRunInterface],
  fields: () => ({}),
});

const ToolCallStatusEnum = builder.enumType("ToolCallStatus", {
  values: ["RUNNING", "COMPLETED", "ERROR"] as const,
});

const OutputMessageType = builder.objectRef<OutputMessageRecord>(
  "OutputMessage",
);
OutputMessageType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    role: t.string({ resolve: (parent) => parent.role }),
    content: t.string({ resolve: (parent) => parent.content }),
    messageRefId: t.id({
      nullable: true,
      resolve: (parent) => parent.messageRefId ?? null,
    }),
  }),
});

const OutputReasoningType = builder.objectRef<OutputReasoningRecord>(
  "OutputReasoning",
);
OutputReasoningType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    summary: t.string({ resolve: (parent) => parent.summary }),
    reasoningType: t.string({
      nullable: true,
      resolve: (parent) => parent.reasoningType ?? null,
    }),
  }),
});

const OutputToolCallType = builder.objectRef<OutputToolCallRecord>(
  "OutputToolCall",
);
OutputToolCallType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    toolCallId: t.id({ resolve: (parent) => parent.toolCallId }),
    toolName: t.string({ resolve: (parent) => parent.toolName }),
    status: t.field({
      type: ToolCallStatusEnum,
      resolve: (parent) => parent.status,
    }),
    argumentsText: t.string({
      nullable: true,
      resolve: (parent) => parent.argumentsText ?? null,
    }),
    resultText: t.string({
      nullable: true,
      resolve: (parent) => parent.resultText ?? null,
    }),
    error: t.string({
      nullable: true,
      resolve: (parent) => parent.error ?? null,
    }),
  }),
});

const OpenResponseOutputItemType = builder.unionType(
  "OpenResponseOutputItem",
  {
    types: [
      OutputMessageType,
      OutputReasoningType,
      OutputToolCallType,
    ] as const,
    resolveType: (parent) => parent.__typename,
  },
);

const OpenResponseEventType = builder.objectRef<{
  id: string;
  type: string;
  data: unknown;
}>("OpenResponseEvent");
OpenResponseEventType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    type: t.string({ resolve: (parent) => parent.type }),
    data: t.field({ type: "JSON", resolve: (parent) => parent.data }),
  }),
});

const OpenResponseType = builder.objectRef<BuildRunRecord>("OpenResponse");
OpenResponseType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => `${parent.id}:open-response` }),
    runId: t.id({ resolve: (parent) => parent.id }),
    status: t.field({
      type: OpenResponseStatusEnum,
      resolve: (parent) => toOpenResponseStatus(parent.status),
    }),
    outputItems: t.connection({
      type: OpenResponseOutputItemType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: (parent, args) => {
        const items = materializeOpenResponseOutputItems(parent);
        logBuildChatDebug("resolver.openResponse.outputItems", {
          runId: parent.id,
          itemCount: items.length,
        });
        return resolveArrayConnection({ args }, items);
      },
    }),
    events: t.connection({
      type: OpenResponseEventType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: (parent, args) => {
        logBuildChatDebug("resolver.openResponse.events", {
          runId: parent.id,
          eventCount: 0,
        });
        return resolveArrayConnection({ args }, []);
      },
    }),
  }),
});

const WorkspaceBuildRunType = builder.objectRef<BuildRunRecord>(
  "WorkspaceBuildRun",
);
WorkspaceBuildRunType.implement({
  interfaces: [WorkspaceRunInterface, WorkspaceConversationRunInterface],
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    workspaceId: t.id({
      resolve: (parent) =>
        asGambitID(
          typeof parent.workspaceId === "string" &&
            parent.workspaceId.length > 0
            ? parent.workspaceId
            : parent.id,
        ),
    }),
    status: t.field({
      type: OpenResponseStatusEnum,
      resolve: (parent) => toOpenResponseStatus(parent.status),
    }),
  }),
});

const BuildStateType = builder.objectRef<BuildStateRecord>("BuildState");
BuildStateType.implement({
  fields: (t) => ({
    workspaceId: t.id({ resolve: (parent) => asGambitID(parent.workspaceId) }),
    transcript: t.connection({
      type: OpenResponseOutputItemType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: (parent, args) => {
        const outputItems = materializeOpenResponseOutputItems(parent.run);
        logBuildChatDebug("resolver.buildState.transcript", {
          runId: parent.run.id,
          itemCount: outputItems.length,
        });
        return resolveArrayConnection({ args }, outputItems);
      },
    }),
    runStatus: t.field({
      type: OpenResponseStatusEnum,
      resolve: (parent) => toOpenResponseStatus(parent.run.status),
    }),
    canSend: t.boolean({
      resolve: (parent) => parent.run.status !== "running",
    }),
    canStop: t.boolean({
      resolve: (parent) => parent.run.status === "running",
    }),
  }),
});

const WorkspaceModelStatusType = builder.objectRef<WorkspaceModelStatusRecord>(
  "WorkspaceModelStatus",
);
WorkspaceModelStatusType.implement({
  fields: (t) => ({
    model: t.string({ resolve: (parent) => parent.model }),
    workspaceId: t.id({ resolve: (parent) => asGambitID(parent.workspaceId) }),
    available: t.boolean({ resolve: (parent) => parent.available }),
    requiresLogin: t.boolean({ resolve: (parent) => parent.requiresLogin }),
    loggedIn: t.boolean({ resolve: (parent) => parent.loggedIn }),
    statusText: t.string({ resolve: (parent) => parent.statusText }),
    trustedPath: t.string({
      nullable: true,
      resolve: (parent) => parent.trustedPath ?? null,
    }),
    writeEnabled: t.boolean({ resolve: (parent) => parent.writeEnabled }),
  }),
});

const WorkspaceModelsType = builder.objectRef<WorkspaceModelsRecord>(
  "WorkspaceModels",
);
WorkspaceModelsType.implement({
  fields: (t) => ({
    codex: t.field({
      type: WorkspaceModelStatusType,
      args: {
        checkOnline: t.arg.boolean(),
      },
      resolve: async (parent, args, context) => {
        if (!context.readWorkspaceModelStatus) {
          return {
            model: "codex" as const,
            workspaceId: parent.workspaceId,
            available: false,
            requiresLogin: true,
            loggedIn: false,
            statusText: "Model status resolver is unavailable.",
            writeEnabled: false,
          };
        }
        return await context.readWorkspaceModelStatus({
          workspaceId: parent.workspaceId,
          model: "codex",
          checkOnline: args.checkOnline ?? false,
        });
      },
    }),
  }),
});

const WorkspaceGradeRunStatusEnum = builder.enumType(
  "WorkspaceGradeRunStatus",
  {
    values: ["RUNNING", "COMPLETED", "ERROR"] as const,
  },
);

function toWorkspaceGradeRunStatus(
  value: WorkspaceGradeRunRecord["status"],
): "RUNNING" | "COMPLETED" | "ERROR" {
  if (value === "running") return "RUNNING";
  if (value === "completed") return "COMPLETED";
  return "ERROR";
}

const VERIFY_CONSISTENCY_THRESHOLDS = {
  minSampleSize: 6,
  instabilityScoreDelta: 1.5,
  pass: {
    agreementMin: 0.9,
    maxSpread: 1,
    maxInstabilityCount: 0,
  },
  warn: {
    agreementMin: 0.75,
    maxSpread: 2,
    maxInstabilityCount: 2,
  },
} as const;

type VerifyExamplePointRecord = {
  runId: string;
  score?: number;
  pass?: boolean;
  reason?: string;
  turnIndex?: number;
  messageRefId?: string;
};

type VerifyExampleBucketRecord = {
  key: string;
  label: string;
  points: Array<VerifyExamplePointRecord>;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(values: Array<number>): Maybe<number> {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function flattenVerifyRunExamples(
  run: WorkspaceGradeRunRecord,
): Array<VerifyExampleBucketRecord> {
  if (run.turns.length > 0) {
    return run.turns.map((turn, fallbackIndex) => {
      const index = typeof turn.turnIndex === "number"
        ? turn.turnIndex
        : fallbackIndex;
      const key = turn.refId && turn.refId.trim().length > 0
        ? `ref:${turn.refId}`
        : `turn:${index}`;
      const pass = typeof turn.score === "number" ? turn.score >= 0 : undefined;
      return {
        key,
        label: `Assistant turn ${turn.turnNumber || fallbackIndex + 1}`,
        points: [{
          runId: run.id,
          score: turn.score,
          pass,
          reason: turn.reason,
          turnIndex: index,
          messageRefId: turn.refId,
        }],
      };
    });
  }

  const score = run.summary?.score;
  const reason = run.summary?.reason;
  const pass = typeof score === "number" ? score >= 0 : undefined;
  return [{
    key: "conversation",
    label: "Conversation score",
    points: [{
      runId: run.id,
      score,
      pass,
      reason,
    }],
  }];
}

function resolveVerifyVerdict(input: {
  sampleSize: number;
  agreementRate: Maybe<number>;
  spreadMax: Maybe<number>;
  instabilityCount: number;
}): { verdict: "PASS" | "WARN" | "FAIL"; reason: string } {
  if (input.sampleSize < VERIFY_CONSISTENCY_THRESHOLDS.minSampleSize) {
    return {
      verdict: "WARN",
      reason:
        `Need at least ${VERIFY_CONSISTENCY_THRESHOLDS.minSampleSize} samples before issuing a firm verdict.`,
    };
  }
  if (input.agreementRate === null) {
    return {
      verdict: "WARN",
      reason: "No comparable pass/fail evidence was found in the sampled runs.",
    };
  }
  const spreadMax = input.spreadMax ?? 0;
  if (
    input.agreementRate >= VERIFY_CONSISTENCY_THRESHOLDS.pass.agreementMin &&
    spreadMax <= VERIFY_CONSISTENCY_THRESHOLDS.pass.maxSpread &&
    input.instabilityCount <=
      VERIFY_CONSISTENCY_THRESHOLDS.pass.maxInstabilityCount
  ) {
    return {
      verdict: "PASS",
      reason: "Agreement, spread, and instability all meet PASS thresholds.",
    };
  }
  if (
    input.agreementRate >= VERIFY_CONSISTENCY_THRESHOLDS.warn.agreementMin &&
    spreadMax <= VERIFY_CONSISTENCY_THRESHOLDS.warn.maxSpread &&
    input.instabilityCount <=
      VERIFY_CONSISTENCY_THRESHOLDS.warn.maxInstabilityCount
  ) {
    return {
      verdict: "WARN",
      reason:
        "Some variation was detected, but results remain within WARN thresholds.",
    };
  }
  return {
    verdict: "FAIL",
    reason: "Agreement/spread instability exceeds WARN thresholds.",
  };
}

function buildVerifyMetricsFromRuns(
  runs: Array<WorkspaceGradeRunRecord>,
): WorkspaceVerifyMetricsRecord {
  const completedRuns = runs.filter((run) => run.status === "completed");
  const sampleSize = completedRuns.length;
  const bucketsByKey = new Map<string, VerifyExampleBucketRecord>();

  completedRuns.forEach((run) => {
    flattenVerifyRunExamples(run).forEach((entry) => {
      const existing = bucketsByKey.get(entry.key);
      if (!existing) {
        bucketsByKey.set(entry.key, {
          key: entry.key,
          label: entry.label,
          points: [...entry.points],
        });
        return;
      }
      existing.points.push(...entry.points);
    });
  });

  const outliers: Array<WorkspaceVerifyOutlierRecord> = [];
  let agreementVotes = 0;
  let agreementTotal = 0;
  const scoreDeltas: Array<number> = [];

  bucketsByKey.forEach((bucket) => {
    const scores = bucket.points
      .map((point) => point.score)
      .filter((score): score is number =>
        typeof score === "number" && Number.isFinite(score)
      );
    const minScore = scores.length > 0 ? Math.min(...scores) : null;
    const maxScore = scores.length > 0 ? Math.max(...scores) : null;
    const scoreDelta = minScore !== null && maxScore !== null
      ? round2(maxScore - minScore)
      : null;

    const passVotes = bucket.points
      .map((point) => point.pass)
      .filter((pass): pass is boolean => typeof pass === "boolean");
    const passCount = passVotes.filter((value) => value).length;
    const failCount = passVotes.length - passCount;
    const agreementRate = passVotes.length > 0
      ? round2(Math.max(passCount, failCount) / passVotes.length)
      : null;

    if (passVotes.length > 0) {
      agreementVotes += Math.max(passCount, failCount);
      agreementTotal += passVotes.length;
    }
    if (scoreDelta !== null) {
      scoreDeltas.push(scoreDelta);
    }

    const passFlip = passCount > 0 && failCount > 0;
    const instability = passFlip ||
      (scoreDelta !== null &&
        scoreDelta > VERIFY_CONSISTENCY_THRESHOLDS.instabilityScoreDelta);

    const minPoint = minScore === null
      ? undefined
      : bucket.points.find((point) => point.score === minScore);
    const maxPoint = maxScore === null
      ? undefined
      : bucket.points.find((point) => point.score === maxScore);

    outliers.push({
      key: bucket.key,
      label: bucket.label,
      sampleSize: bucket.points.length,
      agreementRate,
      scoreDelta,
      passFlip,
      instability,
      minRunId: minPoint?.runId,
      maxRunId: maxPoint?.runId,
      turnIndex: maxPoint?.turnIndex ?? minPoint?.turnIndex,
      messageRefId: maxPoint?.messageRefId ?? minPoint?.messageRefId,
    });
  });

  outliers.sort((left, right) => {
    if (left.instability !== right.instability) {
      return left.instability ? -1 : 1;
    }
    if (left.passFlip !== right.passFlip) return left.passFlip ? -1 : 1;
    const leftDelta = left.scoreDelta ?? -1;
    const rightDelta = right.scoreDelta ?? -1;
    if (leftDelta !== rightDelta) return rightDelta - leftDelta;
    if (left.sampleSize !== right.sampleSize) {
      return right.sampleSize - left.sampleSize;
    }
    return left.label.localeCompare(right.label);
  });

  const agreementRate = agreementTotal > 0
    ? round2(agreementVotes / agreementTotal)
    : null;
  const scoreSpreadMin = scoreDeltas.length > 0
    ? Math.min(...scoreDeltas)
    : null;
  const scoreSpreadMax = scoreDeltas.length > 0
    ? Math.max(...scoreDeltas)
    : null;
  const scoreSpreadMedian = median(scoreDeltas);
  const instabilityCount = outliers.filter((entry) => entry.instability).length;
  const verdict = resolveVerifyVerdict({
    sampleSize,
    agreementRate,
    spreadMax: scoreSpreadMax,
    instabilityCount,
  });

  return {
    sampleSize,
    agreementRate,
    scoreSpreadMin: scoreSpreadMin === null ? null : round2(scoreSpreadMin),
    scoreSpreadMedian: scoreSpreadMedian === null
      ? null
      : round2(scoreSpreadMedian),
    scoreSpreadMax: scoreSpreadMax === null ? null : round2(scoreSpreadMax),
    instabilityCount,
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
    outliers,
  };
}

function toWorkspaceVerifyBatchStatus(
  value: WorkspaceVerifyBatchRecord["status"],
): "IDLE" | "RUNNING" | "COMPLETED" | "ERROR" {
  if (value === "running") return "RUNNING";
  if (value === "completed") return "COMPLETED";
  if (value === "error") return "ERROR";
  return "IDLE";
}

function toWorkspaceVerifyBatchRequestStatus(
  value: WorkspaceVerifyBatchRequestRecord["status"],
): "QUEUED" | "RUNNING" | "COMPLETED" | "ERROR" {
  if (value === "running") return "RUNNING";
  if (value === "completed") return "COMPLETED";
  if (value === "error") return "ERROR";
  return "QUEUED";
}

const WorkspaceVerifyBatchStatusEnum = builder.enumType(
  "WorkspaceVerifyBatchStatus",
  {
    values: ["IDLE", "RUNNING", "COMPLETED", "ERROR"] as const,
  },
);

const WorkspaceVerifyBatchRequestStatusEnum = builder.enumType(
  "WorkspaceVerifyBatchRequestStatus",
  {
    values: ["QUEUED", "RUNNING", "COMPLETED", "ERROR"] as const,
  },
);

const WorkspaceVerifyVerdictEnum = builder.enumType("WorkspaceVerifyVerdict", {
  values: ["PASS", "WARN", "FAIL"] as const,
});

const WorkspaceGradeTurnType = builder.objectRef<WorkspaceGradeTurnRecord>(
  "WorkspaceGradeTurn",
);
WorkspaceGradeTurnType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    runId: t.id({ resolve: (parent) => parent.runId }),
    turnIndex: t.int({ resolve: (parent) => parent.turnIndex }),
    turnNumber: t.int({ resolve: (parent) => parent.turnNumber }),
    refId: t.id({ resolve: (parent) => parent.refId }),
    score: t.float({
      nullable: true,
      resolve: (parent) => parent.score ?? null,
    }),
    reason: t.string({
      nullable: true,
      resolve: (parent) => parent.reason ?? null,
    }),
    priorUser: t.string({
      nullable: true,
      resolve: (parent) => parent.priorUser ?? null,
    }),
    gradedAssistant: t.string({
      nullable: true,
      resolve: (parent) => parent.gradedAssistant ?? null,
    }),
  }),
});

const WorkspaceGradeRunSummaryType = builder.objectRef<{
  score?: number;
  reason?: string;
}>("WorkspaceGradeRunSummary");
WorkspaceGradeRunSummaryType.implement({
  fields: (t) => ({
    score: t.float({
      nullable: true,
      resolve: (parent) => parent.score ?? null,
    }),
    reason: t.string({
      nullable: true,
      resolve: (parent) => parent.reason ?? null,
    }),
  }),
});

const WorkspaceGradeRunType = builder.objectRef<WorkspaceGradeRunRecord>(
  "WorkspaceGradeRun",
);
WorkspaceGradeRunType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    workspaceId: t.id({ resolve: (parent) => parent.workspaceId }),
    scenarioRunId: t.id({
      nullable: true,
      resolve: (parent) => parent.scenarioRunId ?? null,
    }),
    graderId: t.id({ resolve: (parent) => parent.graderId }),
    graderPath: t.string({ resolve: (parent) => parent.graderPath }),
    graderLabel: t.string({
      nullable: true,
      resolve: (parent) => parent.graderLabel ?? null,
    }),
    status: t.field({
      type: WorkspaceGradeRunStatusEnum,
      resolve: (parent) => toWorkspaceGradeRunStatus(parent.status),
    }),
    runAt: t.string({
      nullable: true,
      resolve: (parent) => parent.runAt ?? null,
    }),
    error: t.string({
      nullable: true,
      resolve: (parent) => parent.error ?? null,
    }),
    summary: t.field({
      type: WorkspaceGradeRunSummaryType,
      nullable: true,
      resolve: (parent) =>
        parent.summary
          ? {
            score: parent.summary.score,
            reason: parent.summary.reason,
          }
          : null,
    }),
    turns: t.field({
      type: [WorkspaceGradeTurnType],
      resolve: (parent) => parent.turns,
    }),
  }),
});

const WorkspaceGraderDeckType = builder.objectRef<WorkspaceGraderDeckRecord>(
  "WorkspaceGraderDeck",
);
WorkspaceGraderDeckType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    label: t.string({ resolve: (parent) => parent.label }),
    description: t.string({
      nullable: true,
      resolve: (parent) => parent.description ?? null,
    }),
    path: t.string({ resolve: (parent) => parent.path }),
  }),
});

const WorkspaceGradeFlagType = builder.objectRef<WorkspaceGradeFlagRecord>(
  "WorkspaceGradeFlag",
);
WorkspaceGradeFlagType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    refId: t.id({ resolve: (parent) => parent.refId }),
    runId: t.id({
      nullable: true,
      resolve: (parent) => parent.runId ?? null,
    }),
    turnIndex: t.int({
      nullable: true,
      resolve: (parent) => parent.turnIndex ?? null,
    }),
    reason: t.string({
      nullable: true,
      resolve: (parent) => parent.reason ?? null,
    }),
    createdAt: t.string({ resolve: (parent) => parent.createdAt }),
  }),
});

const WorkspaceGradeTabType = builder.objectRef<WorkspaceGradeTabRecord>(
  "WorkspaceGradeTab",
);
WorkspaceGradeTabType.implement({
  fields: (t) => ({
    graderDecks: t.field({
      type: [WorkspaceGraderDeckType],
      resolve: async (parent, _args, context) =>
        context.listWorkspaceGraderDecks
          ? await context.listWorkspaceGraderDecks(parent.workspaceId)
          : [],
    }),
    runs: t.field({
      type: [WorkspaceGradeRunType],
      resolve: async (parent, _args, context) =>
        context.readWorkspaceGradeRuns
          ? await context.readWorkspaceGradeRuns(parent.workspaceId)
          : [],
    }),
    flags: t.field({
      type: [WorkspaceGradeFlagType],
      resolve: async (parent, _args, context) =>
        context.readWorkspaceGradingFlags
          ? await context.readWorkspaceGradingFlags(parent.workspaceId)
          : [],
    }),
  }),
});

const WorkspaceVerifyBatchRequestType = builder.objectRef<
  WorkspaceVerifyBatchRequestRecord
>("WorkspaceVerifyBatchRequest");
WorkspaceVerifyBatchRequestType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    status: t.field({
      type: WorkspaceVerifyBatchRequestStatusEnum,
      resolve: (parent) => toWorkspaceVerifyBatchRequestStatus(parent.status),
    }),
    runId: t.id({
      nullable: true,
      resolve: (parent) => parent.runId ?? null,
    }),
    error: t.string({
      nullable: true,
      resolve: (parent) => parent.error ?? null,
    }),
  }),
});

const WorkspaceVerifyOutlierType = builder.objectRef<
  WorkspaceVerifyOutlierRecord
>(
  "WorkspaceVerifyOutlier",
);
WorkspaceVerifyOutlierType.implement({
  fields: (t) => ({
    key: t.id({ resolve: (parent) => parent.key }),
    label: t.string({ resolve: (parent) => parent.label }),
    sampleSize: t.int({ resolve: (parent) => parent.sampleSize }),
    agreementRate: t.float({
      nullable: true,
      resolve: (parent) => parent.agreementRate,
    }),
    scoreDelta: t.float({
      nullable: true,
      resolve: (parent) => parent.scoreDelta,
    }),
    passFlip: t.boolean({ resolve: (parent) => parent.passFlip }),
    instability: t.boolean({ resolve: (parent) => parent.instability }),
    minRunId: t.id({
      nullable: true,
      resolve: (parent) => parent.minRunId ?? null,
    }),
    maxRunId: t.id({
      nullable: true,
      resolve: (parent) => parent.maxRunId ?? null,
    }),
    turnIndex: t.int({
      nullable: true,
      resolve: (parent) => parent.turnIndex ?? null,
    }),
    messageRefId: t.id({
      nullable: true,
      resolve: (parent) => parent.messageRefId ?? null,
    }),
  }),
});

const WorkspaceVerifyMetricsType = builder.objectRef<
  WorkspaceVerifyMetricsRecord
>(
  "WorkspaceVerifyMetrics",
);
WorkspaceVerifyMetricsType.implement({
  fields: (t) => ({
    sampleSize: t.int({ resolve: (parent) => parent.sampleSize }),
    agreementRate: t.float({
      nullable: true,
      resolve: (parent) => parent.agreementRate,
    }),
    scoreSpreadMin: t.float({
      nullable: true,
      resolve: (parent) => parent.scoreSpreadMin,
    }),
    scoreSpreadMedian: t.float({
      nullable: true,
      resolve: (parent) => parent.scoreSpreadMedian,
    }),
    scoreSpreadMax: t.float({
      nullable: true,
      resolve: (parent) => parent.scoreSpreadMax,
    }),
    instabilityCount: t.int({
      resolve: (parent) => parent.instabilityCount,
    }),
    verdict: t.field({
      type: WorkspaceVerifyVerdictEnum,
      resolve: (parent) => parent.verdict,
    }),
    verdictReason: t.string({
      resolve: (parent) => parent.verdictReason,
    }),
    outliers: t.connection({
      type: WorkspaceVerifyOutlierType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: (parent, args) =>
        resolveArrayConnection({ args }, parent.outliers),
    }),
  }),
});

const WorkspaceVerifyBatchType = builder.objectRef<WorkspaceVerifyBatchRecord>(
  "WorkspaceVerifyBatch",
);
WorkspaceVerifyBatchType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    workspaceId: t.id({ resolve: (parent) => parent.workspaceId }),
    graderId: t.id({ resolve: (parent) => parent.graderId }),
    scenarioRunId: t.id({
      nullable: true,
      resolve: (parent) => parent.scenarioRunId ?? null,
    }),
    status: t.field({
      type: WorkspaceVerifyBatchStatusEnum,
      resolve: (parent) => toWorkspaceVerifyBatchStatus(parent.status),
    }),
    startedAt: t.string({
      nullable: true,
      resolve: (parent) => parent.startedAt ?? null,
    }),
    finishedAt: t.string({
      nullable: true,
      resolve: (parent) => parent.finishedAt ?? null,
    }),
    requested: t.int({ resolve: (parent) => parent.requested }),
    active: t.int({ resolve: (parent) => parent.active }),
    completed: t.int({ resolve: (parent) => parent.completed }),
    failed: t.int({ resolve: (parent) => parent.failed }),
    requests: t.connection({
      type: WorkspaceVerifyBatchRequestType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: (parent, args) =>
        resolveArrayConnection({ args }, parent.requests),
    }),
    metrics: t.field({
      type: WorkspaceVerifyMetricsType,
      nullable: true,
      resolve: async (parent, _args, context) => {
        if (!context.readWorkspaceGradeRuns) return null;
        const completedRunIds = parent.requests
          .filter((request) =>
            request.status === "completed" &&
            typeof request.runId === "string" &&
            request.runId.trim().length > 0
          )
          .map((request) => request.runId as string);
        if (completedRunIds.length === 0) return null;
        const runIdSet = new Set(completedRunIds);
        const allRuns = await context.readWorkspaceGradeRuns(
          parent.workspaceId,
        );
        const selectedRuns = allRuns.filter((run) => runIdSet.has(run.id));
        if (selectedRuns.length === 0) return null;
        return buildVerifyMetricsFromRuns(selectedRuns);
      },
    }),
  }),
});

const WorkspaceConversationSessionInterface = builder.interfaceRef<
  WorkspaceConversationSessionRecord
>("WorkspaceConversationSession");
WorkspaceConversationSessionInterface.implement({
  resolveType: (parent) => {
    if (parent.kind === "build") return "WorkspaceBuildConversationSession";
    if (parent.kind === "scenario") {
      return "WorkspaceScenarioConversationSession";
    }
    if (parent.kind === "grader") return "WorkspaceGraderConversationSession";
    return "WorkspaceVerifyConversationSession";
  },
  fields: (t) => ({
    id: t.id({ resolve: (parent) => `${parent.kind}:${parent.sessionId}` }),
    sessionId: t.id({ resolve: (parent) => parent.sessionId }),
    workspaceId: t.id({
      resolve: (parent) => asGambitID(parent.workspaceId),
    }),
    status: t.field({
      type: OpenResponseStatusEnum,
      resolve: (parent) => toOpenResponseStatus(parent.status),
    }),
    error: t.string({
      nullable: true,
      resolve: (parent) => parent.error ?? null,
    }),
    startedAt: t.string({
      nullable: true,
      resolve: (parent) => parent.startedAt ?? null,
    }),
    finishedAt: t.string({
      nullable: true,
      resolve: (parent) => parent.finishedAt ?? null,
    }),
    transcript: t.connection({
      type: OpenResponseOutputItemType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: (parent, args) => {
        const run = parent.buildRun ?? parent.scenarioRun;
        if (!run) return resolveArrayConnection({ args }, []);
        const normalizedRun = {
          ...run,
          conversationRunKind: parent.kind === "scenario"
            ? "scenario"
            : "build",
        } satisfies BuildRunRecord;
        return resolveArrayConnection(
          { args },
          materializeOpenResponseOutputItems(normalizedRun),
        );
      },
    }),
  }),
});

const WorkspaceBuildConversationSessionType = builder.objectRef<
  WorkspaceConversationSessionRecord
>("WorkspaceBuildConversationSession");
WorkspaceBuildConversationSessionType.implement({
  interfaces: [WorkspaceConversationSessionInterface],
  isTypeOf: (parent) =>
    isWorkspaceConversationSessionRecord(parent) && parent.kind === "build",
  fields: (t) => ({
    run: t.field({
      type: WorkspaceConversationRunInterface,
      resolve: (parent) => {
        if (!parent.buildRun) {
          throw new Error(
            "WorkspaceBuildConversationSession missing build run",
          );
        }
        return {
          ...parent.buildRun,
          workspaceId: parent.workspaceId,
          conversationRunKind: "build" as const,
        };
      },
    }),
  }),
});

const WorkspaceScenarioConversationSessionType = builder.objectRef<
  WorkspaceConversationSessionRecord
>("WorkspaceScenarioConversationSession");
WorkspaceScenarioConversationSessionType.implement({
  interfaces: [WorkspaceConversationSessionInterface],
  isTypeOf: (parent) =>
    isWorkspaceConversationSessionRecord(parent) && parent.kind === "scenario",
  fields: (t) => ({
    run: t.field({
      type: WorkspaceConversationRunInterface,
      resolve: (parent) => {
        if (!parent.scenarioRun) {
          throw new Error(
            "WorkspaceScenarioConversationSession missing scenario run",
          );
        }
        return {
          ...parent.scenarioRun,
          workspaceId: parent.workspaceId,
          conversationRunKind: "scenario" as const,
        };
      },
    }),
  }),
});

const WorkspaceGraderConversationSessionType = builder.objectRef<
  WorkspaceConversationSessionRecord
>("WorkspaceGraderConversationSession");
WorkspaceGraderConversationSessionType.implement({
  interfaces: [WorkspaceConversationSessionInterface],
  isTypeOf: (parent) =>
    isWorkspaceConversationSessionRecord(parent) && parent.kind === "grader",
  fields: (t) => ({
    gradeRun: t.field({
      type: WorkspaceGradeRunType,
      resolve: (parent) => {
        if (!parent.gradeRun) {
          throw new Error(
            "WorkspaceGraderConversationSession missing grade run",
          );
        }
        return parent.gradeRun;
      },
    }),
  }),
});

const WorkspaceVerifyConversationSessionType = builder.objectRef<
  WorkspaceConversationSessionRecord
>("WorkspaceVerifyConversationSession");
WorkspaceVerifyConversationSessionType.implement({
  interfaces: [WorkspaceConversationSessionInterface],
  isTypeOf: (parent) =>
    isWorkspaceConversationSessionRecord(parent) && parent.kind === "verify",
  fields: (t) => ({
    verifyBatch: t.field({
      type: WorkspaceVerifyBatchType,
      resolve: (parent) => {
        if (!parent.verifyBatch) {
          throw new Error(
            "WorkspaceVerifyConversationSession missing verify batch",
          );
        }
        return parent.verifyBatch;
      },
    }),
  }),
});

const WorkspaceVerificationType = builder.objectRef<
  WorkspaceVerificationRecord
>(
  "WorkspaceVerification",
);
WorkspaceVerificationType.implement({
  fields: (t) => ({
    graderDecks: t.connection({
      type: WorkspaceGraderDeckType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: async (parent, args, context) => {
        const graderDecks = context.listWorkspaceGraderDecks
          ? await context.listWorkspaceGraderDecks(parent.workspaceId)
          : [];
        return resolveArrayConnection({ args }, graderDecks);
      },
    }),
    batches: t.connection({
      type: WorkspaceVerifyBatchType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: async (parent, args, context) => {
        const batches = context.readWorkspaceVerifyBatches
          ? await context.readWorkspaceVerifyBatches(parent.workspaceId)
          : [];
        const sorted = [...batches].sort((left, right) => {
          const leftKey = left.startedAt ?? left.finishedAt ?? left.id;
          const rightKey = right.startedAt ?? right.finishedAt ?? right.id;
          return rightKey.localeCompare(leftKey);
        });
        return resolveArrayConnection({ args }, sorted);
      },
    }),
  }),
});

const WorkspaceType = builder.objectRef<WorkspaceRecord>("Workspace");
WorkspaceType.implement({
  fields: (t) => ({
    id: t.id({ resolve: (parent) => parent.id }),
    scenarioDecks: t.field({
      type: [WorkspaceScenarioDeckType],
      resolve: async (parent, _args, context) =>
        context.listWorkspaceScenarioDecks
          ? await context.listWorkspaceScenarioDecks(parent.id)
          : [],
    }),
    assistantDeck: t.field({
      type: WorkspaceAssistantDeckType,
      nullable: true,
      resolve: async (parent, _args, context) =>
        context.readWorkspaceAssistantDeck
          ? await context.readWorkspaceAssistantDeck(parent.id)
          : null,
    }),
    scenarioRuns: t.connection({
      type: WorkspaceConversationRunInterface,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: async (parent, args, context) => {
        const runs = context.readWorkspaceScenarioRuns
          ? await context.readWorkspaceScenarioRuns(parent.id)
          : [];
        return resolveArrayConnection(
          { args },
          runs.map((run) => ({
            ...run,
            conversationRunKind: "scenario" as const,
          })),
        );
      },
    }),
    files: t.connection({
      type: WorkspaceFileType,
      args: {
        id: t.arg.id(),
        pathPrefix: t.arg({
          type: WorkspaceRelativePathScalar,
        }),
      },
      resolve: async (parent, args, context) => {
        const files = await context.readWorkspaceFiles({
          workspaceId: parent.id,
          id: args.id ? asGambitID(args.id) : null,
          pathPrefix: args.pathPrefix ?? null,
        });
        return resolveArrayConnection({ args }, files);
      },
    }),
    build: t.field({
      type: BuildStateType,
      resolve: async (parent, _args, context) => {
        const run = context.readWorkspaceBuildRun
          ? await context.readWorkspaceBuildRun(parent.id)
          : {
            id: parent.id,
            status: "idle" as const,
            messages: [],
            traces: [],
            toolInserts: [],
          };
        return {
          workspaceId: parent.id,
          run,
        };
      },
    }),
    buildRuns: t.connection({
      type: WorkspaceConversationRunInterface,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: async (parent, args, context) => {
        const run = context.readWorkspaceBuildRun
          ? await context.readWorkspaceBuildRun(parent.id)
          : {
            id: parent.id,
            status: "idle" as const,
            messages: [],
            traces: [],
            toolInserts: [],
          };
        return resolveArrayConnection(
          { args },
          [{
            ...run,
            workspaceId: parent.id,
            conversationRunKind: "build" as const,
          }],
        );
      },
    }),
    conversationSessions: t.connection({
      type: WorkspaceConversationSessionInterface,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: async (parent, args, context) => {
        const sessions = context.listWorkspaceConversationSessions
          ? await context.listWorkspaceConversationSessions({
            workspaceId: parent.id,
            kind: null,
          })
          : [];
        return resolveArrayConnection({ args }, sessions);
      },
    }),
    conversationSession: t.field({
      type: WorkspaceConversationSessionInterface,
      nullable: true,
      args: {
        sessionId: t.arg.id({ required: true }),
      },
      resolve: async (parent, args, context) => {
        if (context.listWorkspaceConversationSessions) {
          const sessions = await context.listWorkspaceConversationSessions({
            workspaceId: parent.id,
            kind: null,
          });
          return sessions.find((session) =>
            session.sessionId === args.sessionId
          ) ??
            null;
        }
        if (!context.readWorkspaceConversationSession) return null;
        for (const kind of ["build", "scenario", "grader", "verify"] as const) {
          const session = await context.readWorkspaceConversationSession({
            workspaceId: parent.id,
            kind,
            sessionId: args.sessionId,
          });
          if (session) return session;
        }
        return null;
      },
    }),
    gradeTab: t.field({
      type: WorkspaceGradeTabType,
      resolve: (parent) => ({ workspaceId: parent.id }),
    }),
    verification: t.field({
      type: WorkspaceVerificationType,
      resolve: (parent) => ({ workspaceId: parent.id }),
    }),
    models: t.field({
      type: WorkspaceModelsType,
      resolve: (parent) => ({ workspaceId: parent.id }),
    }),
  }),
});

const WorkspaceCreatePayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  workspaces?: Array<SessionMetaRecord>;
}>("WorkspaceCreatePayload");
WorkspaceCreatePayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    workspaces: t.connection({
      type: WorkspaceSessionMetaType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: async (parent, args, context) => {
        const workspaces = parent.workspaces ??
          (context.listWorkspaces ? await context.listWorkspaces() : []);
        return resolveArrayConnection({ args }, workspaces);
      },
    }),
  }),
});

const WorkspaceBuildRunCreatePayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  run: BuildRunRecord;
}>("WorkspaceBuildRunCreatePayload");
WorkspaceBuildRunCreatePayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    run: t.field({
      type: WorkspaceBuildRunType,
      resolve: (parent) => parent.run,
    }),
  }),
});

const WorkspaceScenarioRunStartPayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  run: ScenarioRunRecord;
}>("WorkspaceScenarioRunStartPayload");
WorkspaceScenarioRunStartPayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    run: t.field({
      type: WorkspaceScenarioRunType,
      resolve: (parent) => parent.run,
    }),
  }),
});

const WorkspaceScenarioRunSendPayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  run: ScenarioRunRecord;
}>("WorkspaceScenarioRunSendPayload");
WorkspaceScenarioRunSendPayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    run: t.field({
      type: WorkspaceScenarioRunType,
      resolve: (parent) => parent.run,
    }),
  }),
});

const WorkspaceScenarioRunStopPayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  run: ScenarioRunRecord;
}>("WorkspaceScenarioRunStopPayload");
WorkspaceScenarioRunStopPayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    run: t.field({
      type: WorkspaceScenarioRunType,
      resolve: (parent) => parent.run,
    }),
  }),
});

const WorkspaceConversationSessionPayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  session: WorkspaceConversationSessionRecord;
}>("WorkspaceConversationSessionPayload");
WorkspaceConversationSessionPayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    session: t.field({
      type: WorkspaceConversationSessionInterface,
      resolve: (parent) => parent.session,
    }),
  }),
});

const WorkspaceGradeRunCreatePayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  run: WorkspaceGradeRunRecord;
}>("WorkspaceGradeRunCreatePayload");
WorkspaceGradeRunCreatePayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    run: t.field({
      type: WorkspaceGradeRunType,
      resolve: (parent) => parent.run,
    }),
  }),
});

const WorkspaceVerifyBatchRunCreatePayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  batch: WorkspaceVerifyBatchRecord;
}>("WorkspaceVerifyBatchRunCreatePayload");
WorkspaceVerifyBatchRunCreatePayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    batch: t.field({
      type: WorkspaceVerifyBatchType,
      resolve: (parent) => parent.batch,
    }),
  }),
});

const WorkspaceGradeFlagTogglePayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  flags: Array<WorkspaceGradeFlagRecord>;
}>("WorkspaceGradeFlagTogglePayload");
WorkspaceGradeFlagTogglePayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    flags: t.field({
      type: [WorkspaceGradeFlagType],
      resolve: (parent) => parent.flags,
    }),
  }),
});

const WorkspaceGradeFlagReasonUpdatePayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  flags: Array<WorkspaceGradeFlagRecord>;
}>("WorkspaceGradeFlagReasonUpdatePayload");
WorkspaceGradeFlagReasonUpdatePayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    flags: t.field({
      type: [WorkspaceGradeFlagType],
      resolve: (parent) => parent.flags,
    }),
  }),
});

const SimulatorStopRunPayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  run: BuildRunRecord;
}>("SimulatorStopRunPayload");
SimulatorStopRunPayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    run: t.field({
      type: WorkspaceBuildRunType,
      resolve: (parent) => parent.run,
    }),
  }),
});

const SimulatorResetWorkspacePayloadType = builder.objectRef<{
  workspace: WorkspaceRecord;
  build: BuildStateRecord;
}>("SimulatorResetWorkspacePayload");
SimulatorResetWorkspacePayloadType.implement({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      resolve: (parent) => parent.workspace,
    }),
    build: t.field({ type: BuildStateType, resolve: (parent) => parent.build }),
  }),
});

const WorkspaceSnapshotUpdateType = builder.objectRef<{
  workspaceId: string;
}>("WorkspaceSnapshotUpdate");
WorkspaceSnapshotUpdateType.implement({
  fields: (t) => ({
    workspaceId: t.id({ resolve: (parent) => parent.workspaceId }),
  }),
});

const WorkspaceRunLifecycleUpdateType = builder.objectRef<{
  workspaceId: string;
  runId?: string;
  status?: string;
}>("WorkspaceRunLifecycleUpdate");
WorkspaceRunLifecycleUpdateType.implement({
  fields: (t) => ({
    workspaceId: t.id({ resolve: (parent) => parent.workspaceId }),
    runId: t.id({
      nullable: true,
      resolve: (parent) => parent.runId ?? null,
    }),
    status: t.string({
      nullable: true,
      resolve: (parent) => parent.status ?? null,
    }),
  }),
});

const OpenResponseEventUpdateType = builder.objectRef<{
  workspaceId: string;
  runId?: string;
  eventType?: string;
}>("OpenResponseEventUpdate");
OpenResponseEventUpdateType.implement({
  fields: (t) => ({
    workspaceId: t.id({ resolve: (parent) => parent.workspaceId }),
    runId: t.id({ nullable: true, resolve: (parent) => parent.runId ?? null }),
    eventType: t.string({
      nullable: true,
      resolve: (parent) => parent.eventType ?? null,
    }),
  }),
});

const WorkspaceUpdatePayloadUnion = builder.unionType(
  "WorkspaceUpdatePayload",
  {
    types: [
      WorkspaceSnapshotUpdateType,
      WorkspaceRunLifecycleUpdateType,
      OpenResponseEventUpdateType,
    ] as const,
    resolveType: (value) => {
      if (
        !value || typeof value !== "object"
      ) return WorkspaceSnapshotUpdateType;
      const record = value as Record<string, unknown>;
      if (
        typeof record.eventType === "string"
      ) return OpenResponseEventUpdateType;
      if (
        typeof record.runId === "string"
      ) return WorkspaceRunLifecycleUpdateType;
      return WorkspaceSnapshotUpdateType;
    },
  },
);

const WorkspaceUpdateType = builder.objectRef<{
  workspaceId: string;
  offset: number;
  occurredAt: string;
  payload:
    | { workspaceId: string }
    | { workspaceId: string; runId?: string; status?: string }
    | { workspaceId: string; runId?: string; eventType?: string };
}>("WorkspaceUpdate");
WorkspaceUpdateType.implement({
  fields: (t) => ({
    workspaceId: t.id({ resolve: (parent) => asGambitID(parent.workspaceId) }),
    offset: t.int({ resolve: (parent) => parent.offset }),
    occurredAt: t.string({ resolve: (parent) => parent.occurredAt }),
    payload: t.field({
      type: WorkspaceUpdatePayloadUnion,
      resolve: (parent) => parent.payload,
    }),
  }),
});

const WorkspaceBuildLiveEdgeType = builder.objectRef<{
  workspaceId: string;
  sourceOffset: number;
  occurredAt: string;
}>("WorkspaceBuildLiveEdge");
WorkspaceBuildLiveEdgeType.implement({
  fields: (t) => ({
    cursor: t.string({
      resolve: (parent) => String(parent.sourceOffset),
    }),
    sourceOffset: t.int({ resolve: (parent) => parent.sourceOffset }),
    occurredAt: t.string({ resolve: (parent) => parent.occurredAt }),
    node: t.field({
      type: WorkspaceType,
      resolve: (parent) => ({ id: asGambitID(parent.workspaceId) }),
    }),
  }),
});

const WORKSPACE_STREAM_ID = "gambit-workspace";

function normalizeStreamEventType(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "gambit.event";
  }
  const rawType = (value as { type?: unknown }).type;
  if (typeof rawType !== "string" || rawType.trim().length === 0) {
    return "gambit.event";
  }
  return rawType;
}

type DurableStreamWorkspaceEvent = {
  offset: number;
  createdAt: string;
  data: unknown;
};

function normalizeWorkspaceId(value: unknown): Maybe<string> {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function payloadAsRecord(payload: unknown): Maybe<Record<string, unknown>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

function toCanonicalBuildEventType(type: string): string {
  if (type === "buildBotStatus") return "gambit.build.status";
  if (type === "buildBotTrace") return "gambit.build.trace";
  if (type === "buildBotStream") return "gambit.build.stream.delta";
  if (type === "buildBotStreamEnd") return "gambit.build.stream.done";
  if (type === "testBotStatus") return "gambit.test.status";
  if (type === "testBotTrace") return "gambit.test.trace";
  if (type === "testBotStream") return "gambit.test.stream.delta";
  if (type === "testBotStreamEnd") return "gambit.test.stream.done";
  if (type === "gambit.grade.status") return "gambit.grade.status";
  if (type === "gambit.grade.flag") return "gambit.grade.flag";
  if (type === "gambit.verify.batch") return "gambit.verify.batch";
  if (type === "workspaceGraphRefresh") {
    return "gambit.workspace.graph.refresh";
  }
  return type;
}

function toRunId(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.runId === "string" && payload.runId.trim().length > 0) {
    return payload.runId;
  }
  const run = payloadAsRecord(payload.run);
  if (run && typeof run.id === "string" && run.id.trim().length > 0) {
    return run.id;
  }
  return undefined;
}

function toWorkspaceRunStatus(
  payload: Record<string, unknown>,
): string | undefined {
  const run = payloadAsRecord(payload.run);
  if (!run || typeof run.status !== "string") return undefined;
  const trimmed = run.status.trim();
  if (!trimmed) return undefined;
  return trimmed.toUpperCase();
}

function deriveWorkspaceId(payload: Record<string, unknown>): Maybe<string> {
  if (
    typeof payload.workspaceId === "string" &&
    payload.workspaceId.trim().length > 0
  ) {
    return payload.workspaceId.trim();
  }
  const run = payloadAsRecord(payload.run);
  if (run) {
    if (
      typeof run.workspaceId === "string" && run.workspaceId.trim().length > 0
    ) {
      return run.workspaceId.trim();
    }
    if (typeof run.sessionId === "string" && run.sessionId.trim().length > 0) {
      return run.sessionId.trim();
    }
  }
  if (typeof payload.runId === "string" && payload.runId.trim().length > 0) {
    return payload.runId.trim();
  }
  return null;
}

function projectWorkspaceUpdateFromStreamEvent(
  event: DurableStreamWorkspaceEvent,
  expectedWorkspaceId: string,
): Maybe<{
  workspaceId: string;
  offset: number;
  occurredAt: string;
  payload:
    | { workspaceId: string }
    | { workspaceId: string; runId?: string; status?: string }
    | { workspaceId: string; runId?: string; eventType?: string };
}> {
  const data = payloadAsRecord(event.data);
  if (!data || typeof data.type !== "string") return null;

  const workspaceId = deriveWorkspaceId(data);
  if (!workspaceId || workspaceId !== expectedWorkspaceId) return null;

  const canonicalType = toCanonicalBuildEventType(data.type);
  if (canonicalType === "gambit.build.status") {
    return {
      workspaceId,
      offset: event.offset,
      occurredAt: event.createdAt,
      payload: {
        workspaceId,
        runId: toRunId(data),
        status: toWorkspaceRunStatus(data),
      },
    };
  }

  if (
    canonicalType === "gambit.build.trace" ||
    canonicalType === "gambit.build.stream.delta" ||
    canonicalType === "gambit.build.stream.done" ||
    canonicalType === "gambit.grade.flag" ||
    canonicalType === "gambit.verify.batch"
  ) {
    return {
      workspaceId,
      offset: event.offset,
      occurredAt: event.createdAt,
      payload: {
        workspaceId,
        runId: toRunId(data),
        eventType: canonicalType,
      },
    };
  }

  if (canonicalType === "gambit.grade.status") {
    return {
      workspaceId,
      offset: event.offset,
      occurredAt: event.createdAt,
      payload: {
        workspaceId,
        runId: toRunId(data),
        status: toWorkspaceRunStatus(data),
      },
    };
  }

  return {
    workspaceId,
    offset: event.offset,
    occurredAt: event.createdAt,
    payload: { workspaceId },
  };
}

function projectWorkspaceBuildLiveFromStreamEvent(
  event: DurableStreamWorkspaceEvent,
  expectedWorkspaceId: string,
  family: "build" | "test" | "grade" | "verify" = "build",
): Maybe<{
  workspaceId: string;
  sourceOffset: number;
  occurredAt: string;
}> {
  const data = payloadAsRecord(event.data);
  if (!data || typeof data.type !== "string") {
    logBuildChatDebug("buildLive.drop.invalid", {
      expectedWorkspaceId,
      sourceOffset: event.offset,
    });
    return null;
  }

  const canonicalType = toCanonicalBuildEventType(data.type);
  const refreshReason = typeof data.reason === "string" ? data.reason : null;
  const refreshPathCount = Array.isArray(data.paths) ? data.paths.length : null;
  if (canonicalType === "gambit.workspace.graph.refresh") {
    logBuildChatDebug("buildLive.graphRefresh.seen", {
      family,
      expectedWorkspaceId,
      sourceOffset: event.offset,
      type: data.type,
      canonicalType,
      refreshReason,
      refreshPathCount,
    });
  }
  const isBuildFamily = family === "build";
  const isTestFamily = family === "test";
  const isGradeFamily = family === "grade";
  const isAllowedFamilyType = isBuildFamily
    ? (
      canonicalType === "gambit.build.status" ||
      canonicalType === "gambit.build.stream.delta" ||
      canonicalType === "gambit.build.stream.done" ||
      canonicalType === "gambit.build.trace"
    )
    : isTestFamily
    ? (
      canonicalType === "gambit.test.status" ||
      canonicalType === "gambit.test.stream.delta" ||
      canonicalType === "gambit.test.stream.done" ||
      canonicalType === "gambit.test.trace"
    )
    : isGradeFamily
    ? (
      canonicalType === "gambit.grade.status" ||
      canonicalType === "gambit.grade.flag"
    )
    : (
      canonicalType === "gambit.verify.batch"
    );
  if (
    !isAllowedFamilyType &&
    canonicalType !== "gambit.workspace.graph.refresh"
  ) {
    logBuildChatDebug("buildLive.drop.type", {
      family,
      expectedWorkspaceId,
      sourceOffset: event.offset,
      type: data.type,
      canonicalType,
      refreshReason,
      refreshPathCount,
    });
    return null;
  }

  const workspaceId = deriveWorkspaceId(data);
  if (!workspaceId || workspaceId !== expectedWorkspaceId) {
    logBuildChatDebug("buildLive.drop.workspace", {
      family,
      expectedWorkspaceId,
      sourceOffset: event.offset,
      type: data.type,
      canonicalType,
      workspaceId,
      refreshReason,
      refreshPathCount,
    });
    return null;
  }

  logBuildChatDebug("buildLive.accept", {
    family,
    expectedWorkspaceId,
    workspaceId,
    sourceOffset: event.offset,
    type: data.type,
    canonicalType,
    refreshReason,
    refreshPathCount,
  });

  return {
    workspaceId,
    sourceOffset: event.offset,
    occurredAt: event.createdAt,
  };
}

function resolveRequestedFromOffset(
  fromOffset: number | null | undefined,
): { requested: number; effective: number } {
  const requested =
    typeof fromOffset === "number" && Number.isFinite(fromOffset)
      ? Math.max(0, Math.floor(fromOffset))
      : 0;
  const streamHead = Math.max(
    0,
    getDurableStreamNextOffset(WORKSPACE_STREAM_ID),
  );
  const effective = Math.min(requested, streamHead);
  if (effective !== requested) {
    logBuildChatDebug("buildLive.offset.clamped", {
      requestedFromOffset: requested,
      effectiveFromOffset: effective,
      streamHead,
    });
  }
  return { requested, effective };
}

const OpenResponseInputItemInput = builder.inputType(
  "OpenResponseInputItemInput",
  {
    fields: (t) => ({
      role: t.string(),
      content: t.string({ required: true }),
    }),
  },
);

const WorkspaceBuildRunCreateInput = builder.inputType(
  "WorkspaceBuildRunCreateInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      inputItems: t.field({
        required: true,
        type: [OpenResponseInputItemInput],
      }),
    }),
  },
);

const WorkspaceScenarioRunStartInput = builder.inputType(
  "WorkspaceScenarioRunStartInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      scenarioDeckId: t.id(),
      scenarioInput: t.field({ type: "JSON" }),
      assistantInit: t.field({ type: "JSON" }),
    }),
  },
);

const WorkspaceScenarioRunSendInput = builder.inputType(
  "WorkspaceScenarioRunSendInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      runId: t.id({ required: true }),
      inputItems: t.field({
        required: true,
        type: [OpenResponseInputItemInput],
      }),
    }),
  },
);

const WorkspaceScenarioRunStopInput = builder.inputType(
  "WorkspaceScenarioRunStopInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      runId: t.id({ required: true }),
    }),
  },
);

const WorkspaceConversationSessionStartInput = builder.inputType(
  "WorkspaceConversationSessionStartInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      kind: t.string({ required: true }),
      sessionId: t.id(),
      inputItems: t.field({ type: [OpenResponseInputItemInput] }),
      scenarioDeckId: t.id(),
      scenarioInput: t.field({ type: "JSON" }),
      assistantInit: t.field({ type: "JSON" }),
      graderId: t.id(),
      scenarioRunId: t.id(),
      batchSize: t.int(),
      concurrency: t.int(),
    }),
  },
);

const WorkspaceConversationSessionSendInput = builder.inputType(
  "WorkspaceConversationSessionSendInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      kind: t.string({ required: true }),
      sessionId: t.id({ required: true }),
      inputItems: t.field({
        required: true,
        type: [OpenResponseInputItemInput],
      }),
    }),
  },
);

const WorkspaceConversationSessionStopInput = builder.inputType(
  "WorkspaceConversationSessionStopInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      kind: t.string({ required: true }),
      sessionId: t.id({ required: true }),
    }),
  },
);

const WorkspaceGradeRunCreateInput = builder.inputType(
  "WorkspaceGradeRunCreateInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      graderId: t.id({ required: true }),
      scenarioRunId: t.id(),
    }),
  },
);

const WorkspaceVerifyBatchRunCreateInput = builder.inputType(
  "WorkspaceVerifyBatchRunCreateInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      graderId: t.id({ required: true }),
      scenarioRunId: t.id(),
      batchSize: t.int({ required: true }),
      concurrency: t.int({ required: true }),
    }),
  },
);

const WorkspaceGradeFlagToggleInput = builder.inputType(
  "WorkspaceGradeFlagToggleInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      refId: t.id({ required: true }),
      runId: t.id({ required: true }),
      turnIndex: t.int(),
    }),
  },
);

const WorkspaceGradeFlagReasonUpdateInput = builder.inputType(
  "WorkspaceGradeFlagReasonUpdateInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
      refId: t.id({ required: true }),
      reason: t.string({ required: true }),
    }),
  },
);

const SimulatorStopRunInput = builder.inputType("SimulatorStopRunInput", {
  fields: (t) => ({
    workspaceId: t.id({ required: true }),
    runId: t.id({ required: true }),
  }),
});

const SimulatorResetWorkspaceInput = builder.inputType(
  "SimulatorResetWorkspaceInput",
  {
    fields: (t) => ({
      workspaceId: t.id({ required: true }),
    }),
  },
);

builder.queryType({
  fields: (t) => ({
    workspace: t.field({
      type: WorkspaceType,
      args: {
        id: t.arg.id({ required: true }),
      },
      resolve: (_parent, args) => ({ id: asGambitID(args.id) }),
    }),
    gambitWorkspaces: t.connection({
      type: WorkspaceSessionMetaType,
      args: {
        first: t.arg.int(),
        after: t.arg.string(),
      },
      resolve: async (_parent, args, context) => {
        const workspaces = context.listWorkspaces
          ? await context.listWorkspaces()
          : [];
        return resolveArrayConnection({ args }, workspaces);
      },
    }),
    gambitDurableStreamReplay: t.field({
      type: StreamReplayType,
      args: {
        streamId: t.arg.id({ required: true }),
        fromOffset: t.arg.int(),
      },
      resolve: (_parent, args) => {
        const streamId = asGambitStreamID(args.streamId);
        const fromOffset = typeof args.fromOffset === "number"
          ? Math.max(0, args.fromOffset)
          : 0;
        const events = readDurableStreamEvents(streamId, fromOffset).map(
          (event) => ({
            offset: event.offset,
            createdAt: asGambitISODateTime(event.createdAt),
            type: normalizeStreamEventType(event.data),
            data: event.data,
          }),
        );
        return {
          streamId,
          fromOffset,
          nextOffset: getDurableStreamNextOffset(streamId),
          events,
        };
      },
    }),
  }),
});

builder.mutationType({
  fields: (t) => ({
    gambitWorkspaceCreate: t.field({
      type: WorkspaceCreatePayloadType,
      resolve: async (_parent, _args, context) => {
        const created = context.createWorkspace
          ? await context.createWorkspace()
          : { workspaceId: "" };
        return {
          workspace: { id: asGambitID(created.workspaceId) },
        };
      },
    }),
    gambitWorkspaceDelete: t.field({
      type: WorkspaceDeletePayloadType,
      args: {
        workspaceId: t.arg.id({ required: true }),
      },
      resolve: async (_parent, args, context) => {
        const result = context.deleteWorkspace
          ? await context.deleteWorkspace(args.workspaceId)
          : { ok: false, error: "workspace_delete_unavailable" };
        return result.ok ? { workspaceId: args.workspaceId, deleted: true } : {
          workspaceId: args.workspaceId,
          deleted: false,
          error: result.error ?? "Workspace delete failed",
        };
      },
    }),
    workspaceBuildRunCreate: t.field({
      type: WorkspaceBuildRunCreatePayloadType,
      args: {
        input: t.arg({ type: WorkspaceBuildRunCreateInput, required: true }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.createWorkspaceBuildRun) {
          throw new Error("workspace build run create is unavailable");
        }
        const message = (args.input.inputItems ?? [])
          .map((item) => item.content.trim())
          .filter((value) => value.length > 0)
          .join("\n")
          .trim();
        const run = await context.createWorkspaceBuildRun(
          args.input.workspaceId,
          message,
        );
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          run,
        };
      },
    }),
    workspaceScenarioRunStart: t.field({
      type: WorkspaceScenarioRunStartPayloadType,
      args: {
        input: t.arg({
          type: WorkspaceScenarioRunStartInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.createWorkspaceScenarioRun) {
          throw new Error("workspace scenario run start is unavailable");
        }
        const run = await context.createWorkspaceScenarioRun({
          workspaceId: args.input.workspaceId,
          scenarioDeckId: args.input.scenarioDeckId ?? null,
          scenarioInput: args.input.scenarioInput,
          assistantInit: args.input.assistantInit,
        });
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          run,
        };
      },
    }),
    workspaceScenarioRunSend: t.field({
      type: WorkspaceScenarioRunSendPayloadType,
      args: {
        input: t.arg({
          type: WorkspaceScenarioRunSendInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.sendWorkspaceScenarioRun) {
          throw new Error("workspace scenario run send is unavailable");
        }
        const message = (args.input.inputItems ?? [])
          .map((item) => item.content.trim())
          .filter((value) => value.length > 0)
          .join("\n")
          .trim();
        const run = await context.sendWorkspaceScenarioRun({
          workspaceId: args.input.workspaceId,
          runId: args.input.runId,
          message,
        });
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          run,
        };
      },
    }),
    workspaceConversationSessionStart: t.field({
      type: WorkspaceConversationSessionPayloadType,
      args: {
        input: t.arg({
          type: WorkspaceConversationSessionStartInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.startWorkspaceConversationSession) {
          throw new Error(
            "workspace conversation session start is unavailable",
          );
        }
        const message = (args.input.inputItems ?? [])
          .map((item) => item.content.trim())
          .filter((value) => value.length > 0)
          .join("\n")
          .trim();
        const session = await context.startWorkspaceConversationSession({
          workspaceId: args.input.workspaceId,
          kind: parseWorkspaceConversationSessionKind(args.input.kind),
          sessionId: args.input.sessionId ?? null,
          message,
          scenarioDeckId: args.input.scenarioDeckId ?? null,
          scenarioInput: args.input.scenarioInput,
          assistantInit: args.input.assistantInit,
          graderId: args.input.graderId ?? null,
          scenarioRunId: args.input.scenarioRunId ?? null,
          batchSize: args.input.batchSize ?? null,
          concurrency: args.input.concurrency ?? null,
        });
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          session,
        };
      },
    }),
    workspaceConversationSessionSend: t.field({
      type: WorkspaceConversationSessionPayloadType,
      args: {
        input: t.arg({
          type: WorkspaceConversationSessionSendInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.sendWorkspaceConversationSession) {
          throw new Error("workspace conversation session send is unavailable");
        }
        const message = (args.input.inputItems ?? [])
          .map((item) => item.content.trim())
          .filter((value) => value.length > 0)
          .join("\n")
          .trim();
        const session = await context.sendWorkspaceConversationSession({
          workspaceId: args.input.workspaceId,
          kind: parseWorkspaceConversationSessionKind(args.input.kind),
          sessionId: args.input.sessionId,
          message,
        });
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          session,
        };
      },
    }),
    workspaceScenarioRunStop: t.field({
      type: WorkspaceScenarioRunStopPayloadType,
      args: {
        input: t.arg({
          type: WorkspaceScenarioRunStopInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.stopWorkspaceScenarioRun) {
          throw new Error("workspace scenario run stop is unavailable");
        }
        const run = await context.stopWorkspaceScenarioRun({
          workspaceId: args.input.workspaceId,
          runId: args.input.runId,
        });
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          run,
        };
      },
    }),
    workspaceConversationSessionStop: t.field({
      type: WorkspaceConversationSessionPayloadType,
      args: {
        input: t.arg({
          type: WorkspaceConversationSessionStopInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.stopWorkspaceConversationSession) {
          throw new Error("workspace conversation session stop is unavailable");
        }
        const session = await context.stopWorkspaceConversationSession({
          workspaceId: args.input.workspaceId,
          kind: parseWorkspaceConversationSessionKind(args.input.kind),
          sessionId: args.input.sessionId,
        });
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          session,
        };
      },
    }),
    workspaceGradeRunCreate: t.field({
      type: WorkspaceGradeRunCreatePayloadType,
      args: {
        input: t.arg({
          type: WorkspaceGradeRunCreateInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.createWorkspaceGradeRun) {
          throw new Error("workspace grade run create is unavailable");
        }
        const run = await context.createWorkspaceGradeRun({
          workspaceId: args.input.workspaceId,
          graderId: args.input.graderId,
          scenarioRunId: args.input.scenarioRunId ?? null,
        });
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          run,
        };
      },
    }),
    workspaceVerifyBatchRunCreate: t.field({
      type: WorkspaceVerifyBatchRunCreatePayloadType,
      args: {
        input: t.arg({
          type: WorkspaceVerifyBatchRunCreateInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.createWorkspaceVerifyBatchRun) {
          throw new Error("workspace verify batch run create is unavailable");
        }
        const batch = await context.createWorkspaceVerifyBatchRun({
          workspaceId: args.input.workspaceId,
          graderId: args.input.graderId,
          scenarioRunId: args.input.scenarioRunId ?? null,
          batchSize: args.input.batchSize,
          concurrency: args.input.concurrency,
        });
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          batch,
        };
      },
    }),
    workspaceGradeFlagToggle: t.field({
      type: WorkspaceGradeFlagTogglePayloadType,
      args: {
        input: t.arg({
          type: WorkspaceGradeFlagToggleInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.toggleWorkspaceGradeFlag) {
          throw new Error("workspace grade flag toggle is unavailable");
        }
        const flags = await context.toggleWorkspaceGradeFlag({
          workspaceId: args.input.workspaceId,
          refId: args.input.refId,
          runId: args.input.runId,
          turnIndex: args.input.turnIndex ?? null,
        });
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          flags,
        };
      },
    }),
    workspaceGradeFlagReasonUpdate: t.field({
      type: WorkspaceGradeFlagReasonUpdatePayloadType,
      args: {
        input: t.arg({
          type: WorkspaceGradeFlagReasonUpdateInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.updateWorkspaceGradeFlagReason) {
          throw new Error("workspace grade flag reason update is unavailable");
        }
        const flags = await context.updateWorkspaceGradeFlagReason({
          workspaceId: args.input.workspaceId,
          refId: args.input.refId,
          reason: args.input.reason,
        });
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          flags,
        };
      },
    }),
    simulatorStopRun: t.field({
      type: SimulatorStopRunPayloadType,
      args: {
        input: t.arg({ type: SimulatorStopRunInput, required: true }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.stopWorkspaceBuildRun) {
          throw new Error("workspace build run stop is unavailable");
        }
        const run = await context.stopWorkspaceBuildRun(
          args.input.workspaceId,
          args.input.runId,
        );
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          run,
        };
      },
    }),
    simulatorResetWorkspace: t.field({
      type: SimulatorResetWorkspacePayloadType,
      args: {
        input: t.arg({
          type: SimulatorResetWorkspaceInput,
          required: true,
        }),
      },
      resolve: async (_parent, args, context) => {
        if (!context.resetWorkspaceBuild) {
          throw new Error("workspace build reset is unavailable");
        }
        const run = await context.resetWorkspaceBuild(args.input.workspaceId);
        return {
          workspace: { id: asGambitID(args.input.workspaceId) },
          build: {
            workspaceId: args.input.workspaceId,
            run,
          },
        };
      },
    }),
  }),
});

builder.subscriptionType({
  fields: (t) => ({
    workspaceUpdates: t.field({
      type: WorkspaceUpdateType,
      args: {
        workspaceId: t.arg.id({ required: true }),
        fromOffset: t.arg.int(),
      },
      subscribe: async function* (_parent, args) {
        const workspaceId = normalizeWorkspaceId(args.workspaceId);
        if (!workspaceId) return;

        const { effective: requestedFromOffset } = resolveRequestedFromOffset(
          args.fromOffset ?? null,
        );

        const pending: Array<{
          workspaceId: string;
          offset: number;
          occurredAt: string;
          payload:
            | { workspaceId: string }
            | { workspaceId: string; runId?: string; status?: string }
            | { workspaceId: string; runId?: string; eventType?: string };
        }> = [];
        let resolveNext: Maybe<(value: Maybe<typeof pending[number]>) => void> =
          null;
        let closed = false;
        let nextSourceOffset = requestedFromOffset;
        let replaying = true;
        const buffered: Array<DurableStreamWorkspaceEvent> = [];

        const push = (value: typeof pending[number]) => {
          if (closed) return;
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(value);
            return;
          }
          pending.push(value);
        };

        const pull = async (): Promise<Maybe<typeof pending[number]>> => {
          const next = pending.shift();
          if (next) return next;
          return await new Promise((resolve) => {
            resolveNext = resolve;
          });
        };

        const processStreamEvent = (
          streamEvent: DurableStreamWorkspaceEvent,
        ) => {
          if (streamEvent.offset < nextSourceOffset) return;
          nextSourceOffset = streamEvent.offset + 1;
          const projected = projectWorkspaceUpdateFromStreamEvent(
            streamEvent,
            workspaceId,
          );
          if (!projected) return;
          push(projected);
        };

        const unsubscribe = subscribeDurableStream(
          WORKSPACE_STREAM_ID,
          (event) => {
            const streamEvent = event as DurableStreamWorkspaceEvent;
            if (replaying) {
              buffered.push(streamEvent);
              return;
            }
            processStreamEvent(streamEvent);
          },
        );

        try {
          const replay = readDurableStreamEvents(
            WORKSPACE_STREAM_ID,
            requestedFromOffset,
          ) as Array<DurableStreamWorkspaceEvent>;
          for (const streamEvent of replay) {
            processStreamEvent(streamEvent);
          }

          replaying = false;
          if (buffered.length > 0) {
            const sorted = [...buffered].sort((a, b) => a.offset - b.offset);
            buffered.length = 0;
            for (const streamEvent of sorted) {
              processStreamEvent(streamEvent);
            }
          }

          while (true) {
            const next = await pull();
            if (next === null) return;
            yield next;
          }
        } finally {
          closed = true;
          replaying = false;
          buffered.length = 0;
          unsubscribe();
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(null);
          }
        }
      },
      resolve: (parent) => parent,
    }),
    workspaceBuildLive: t.field({
      type: WorkspaceBuildLiveEdgeType,
      args: {
        workspaceId: t.arg.id({ required: true }),
        fromOffset: t.arg.int(),
      },
      subscribe: async function* (_parent, args) {
        const workspaceId = normalizeWorkspaceId(args.workspaceId);
        if (!workspaceId) return;

        const { effective: requestedFromOffset } = resolveRequestedFromOffset(
          args.fromOffset ?? null,
        );

        const pending: Array<{
          workspaceId: string;
          sourceOffset: number;
          occurredAt: string;
        }> = [];
        let resolveNext: Maybe<(value: Maybe<typeof pending[number]>) => void> =
          null;
        let closed = false;
        let nextSourceOffset = requestedFromOffset;
        let replaying = true;
        const buffered: Array<DurableStreamWorkspaceEvent> = [];

        const push = (value: typeof pending[number]) => {
          if (closed) return;
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(value);
            return;
          }
          pending.push(value);
        };

        const pull = async (): Promise<Maybe<typeof pending[number]>> => {
          const next = pending.shift();
          if (next) return next;
          return await new Promise((resolve) => {
            resolveNext = resolve;
          });
        };

        const processStreamEvent = (
          streamEvent: DurableStreamWorkspaceEvent,
        ) => {
          if (streamEvent.offset < nextSourceOffset) return;
          nextSourceOffset = streamEvent.offset + 1;
          const projected = projectWorkspaceBuildLiveFromStreamEvent(
            streamEvent,
            workspaceId,
            "build",
          );
          if (!projected) return;
          push(projected);
        };

        const unsubscribe = subscribeDurableStream(
          WORKSPACE_STREAM_ID,
          (event) => {
            const streamEvent = event as DurableStreamWorkspaceEvent;
            if (replaying) {
              buffered.push(streamEvent);
              return;
            }
            processStreamEvent(streamEvent);
          },
        );

        try {
          const replay = readDurableStreamEvents(
            WORKSPACE_STREAM_ID,
            requestedFromOffset,
          ) as Array<DurableStreamWorkspaceEvent>;
          for (const streamEvent of replay) {
            processStreamEvent(streamEvent);
          }

          replaying = false;
          if (buffered.length > 0) {
            const sorted = [...buffered].sort((a, b) => a.offset - b.offset);
            buffered.length = 0;
            for (const streamEvent of sorted) {
              processStreamEvent(streamEvent);
            }
          }

          while (true) {
            const next = await pull();
            if (next === null) return;
            yield next;
          }
        } finally {
          closed = true;
          replaying = false;
          buffered.length = 0;
          unsubscribe();
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(null);
          }
        }
      },
      resolve: (parent) => parent,
    }),
    workspaceTestLive: t.field({
      type: WorkspaceBuildLiveEdgeType,
      args: {
        workspaceId: t.arg.id({ required: true }),
        fromOffset: t.arg.int(),
      },
      subscribe: async function* (_parent, args) {
        const workspaceId = normalizeWorkspaceId(args.workspaceId);
        if (!workspaceId) return;

        const { effective: requestedFromOffset } = resolveRequestedFromOffset(
          args.fromOffset ?? null,
        );

        const pending: Array<{
          workspaceId: string;
          sourceOffset: number;
          occurredAt: string;
        }> = [];
        let resolveNext: Maybe<(value: Maybe<typeof pending[number]>) => void> =
          null;
        let closed = false;
        let nextSourceOffset = requestedFromOffset;
        let replaying = true;
        const buffered: Array<DurableStreamWorkspaceEvent> = [];

        const push = (value: typeof pending[number]) => {
          if (closed) return;
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(value);
            return;
          }
          pending.push(value);
        };

        const pull = async (): Promise<Maybe<typeof pending[number]>> => {
          const next = pending.shift();
          if (next) return next;
          return await new Promise((resolve) => {
            resolveNext = resolve;
          });
        };

        const processStreamEvent = (
          streamEvent: DurableStreamWorkspaceEvent,
        ) => {
          if (streamEvent.offset < nextSourceOffset) return;
          nextSourceOffset = streamEvent.offset + 1;
          const projected = projectWorkspaceBuildLiveFromStreamEvent(
            streamEvent,
            workspaceId,
            "test",
          );
          if (!projected) return;
          push(projected);
        };

        const unsubscribe = subscribeDurableStream(
          WORKSPACE_STREAM_ID,
          (event) => {
            const streamEvent = event as DurableStreamWorkspaceEvent;
            if (replaying) {
              buffered.push(streamEvent);
              return;
            }
            processStreamEvent(streamEvent);
          },
        );

        try {
          const replay = readDurableStreamEvents(
            WORKSPACE_STREAM_ID,
            requestedFromOffset,
          ) as Array<DurableStreamWorkspaceEvent>;
          for (const streamEvent of replay) {
            processStreamEvent(streamEvent);
          }

          replaying = false;
          if (buffered.length > 0) {
            const sorted = [...buffered].sort((a, b) => a.offset - b.offset);
            buffered.length = 0;
            for (const streamEvent of sorted) {
              processStreamEvent(streamEvent);
            }
          }

          while (true) {
            const next = await pull();
            if (next === null) return;
            yield next;
          }
        } finally {
          closed = true;
          replaying = false;
          buffered.length = 0;
          unsubscribe();
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(null);
          }
        }
      },
      resolve: (parent) => parent,
    }),
    workspaceGradeLive: t.field({
      type: WorkspaceBuildLiveEdgeType,
      args: {
        workspaceId: t.arg.id({ required: true }),
        fromOffset: t.arg.int(),
      },
      subscribe: async function* (_parent, args) {
        const workspaceId = normalizeWorkspaceId(args.workspaceId);
        if (!workspaceId) return;

        const { effective: requestedFromOffset } = resolveRequestedFromOffset(
          args.fromOffset ?? null,
        );

        const pending: Array<{
          workspaceId: string;
          sourceOffset: number;
          occurredAt: string;
        }> = [];
        let resolveNext: Maybe<(value: Maybe<typeof pending[number]>) => void> =
          null;
        let closed = false;
        let nextSourceOffset = requestedFromOffset;
        let replaying = true;
        const buffered: Array<DurableStreamWorkspaceEvent> = [];

        const push = (value: typeof pending[number]) => {
          if (closed) return;
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(value);
            return;
          }
          pending.push(value);
        };

        const pull = async (): Promise<Maybe<typeof pending[number]>> => {
          const next = pending.shift();
          if (next) return next;
          return await new Promise((resolve) => {
            resolveNext = resolve;
          });
        };

        const processStreamEvent = (
          streamEvent: DurableStreamWorkspaceEvent,
        ) => {
          if (streamEvent.offset < nextSourceOffset) return;
          nextSourceOffset = streamEvent.offset + 1;
          const projected = projectWorkspaceBuildLiveFromStreamEvent(
            streamEvent,
            workspaceId,
            "grade",
          );
          if (!projected) return;
          push(projected);
        };

        const unsubscribe = subscribeDurableStream(
          WORKSPACE_STREAM_ID,
          (event) => {
            const streamEvent = event as DurableStreamWorkspaceEvent;
            if (replaying) {
              buffered.push(streamEvent);
              return;
            }
            processStreamEvent(streamEvent);
          },
        );

        try {
          const replay = readDurableStreamEvents(
            WORKSPACE_STREAM_ID,
            requestedFromOffset,
          ) as Array<DurableStreamWorkspaceEvent>;
          for (const streamEvent of replay) {
            processStreamEvent(streamEvent);
          }

          replaying = false;
          if (buffered.length > 0) {
            const sorted = [...buffered].sort((a, b) => a.offset - b.offset);
            buffered.length = 0;
            for (const streamEvent of sorted) {
              processStreamEvent(streamEvent);
            }
          }

          while (true) {
            const next = await pull();
            if (next === null) return;
            yield next;
          }
        } finally {
          closed = true;
          replaying = false;
          buffered.length = 0;
          unsubscribe();
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(null);
          }
        }
      },
      resolve: (parent) => parent,
    }),
    workspaceVerifyLive: t.field({
      type: WorkspaceBuildLiveEdgeType,
      args: {
        workspaceId: t.arg.id({ required: true }),
        fromOffset: t.arg.int(),
      },
      subscribe: async function* (_parent, args) {
        const workspaceId = normalizeWorkspaceId(args.workspaceId);
        if (!workspaceId) return;

        const { effective: requestedFromOffset } = resolveRequestedFromOffset(
          args.fromOffset ?? null,
        );

        const pending: Array<{
          workspaceId: string;
          sourceOffset: number;
          occurredAt: string;
        }> = [];
        let resolveNext: Maybe<(value: Maybe<typeof pending[number]>) => void> =
          null;
        let closed = false;
        let nextSourceOffset = requestedFromOffset;
        let replaying = true;
        const buffered: Array<DurableStreamWorkspaceEvent> = [];

        const push = (value: typeof pending[number]) => {
          if (closed) return;
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(value);
            return;
          }
          pending.push(value);
        };

        const pull = async (): Promise<Maybe<typeof pending[number]>> => {
          const next = pending.shift();
          if (next) return next;
          return await new Promise((resolve) => {
            resolveNext = resolve;
          });
        };

        const processStreamEvent = (
          streamEvent: DurableStreamWorkspaceEvent,
        ) => {
          if (streamEvent.offset < nextSourceOffset) return;
          nextSourceOffset = streamEvent.offset + 1;
          const projected = projectWorkspaceBuildLiveFromStreamEvent(
            streamEvent,
            workspaceId,
            "verify",
          );
          if (!projected) return;
          push(projected);
        };

        const unsubscribe = subscribeDurableStream(
          WORKSPACE_STREAM_ID,
          (event) => {
            const streamEvent = event as DurableStreamWorkspaceEvent;
            if (replaying) {
              buffered.push(streamEvent);
              return;
            }
            processStreamEvent(streamEvent);
          },
        );

        try {
          const replay = readDurableStreamEvents(
            WORKSPACE_STREAM_ID,
            requestedFromOffset,
          ) as Array<DurableStreamWorkspaceEvent>;
          for (const streamEvent of replay) {
            processStreamEvent(streamEvent);
          }

          replaying = false;
          if (buffered.length > 0) {
            const sorted = [...buffered].sort((a, b) => a.offset - b.offset);
            buffered.length = 0;
            for (const streamEvent of sorted) {
              processStreamEvent(streamEvent);
            }
          }

          while (true) {
            const next = await pull();
            if (next === null) return;
            yield next;
          }
        } finally {
          closed = true;
          replaying = false;
          buffered.length = 0;
          unsubscribe();
          if (resolveNext) {
            const resolve = resolveNext;
            resolveNext = null;
            resolve(null);
          }
        }
      },
      resolve: (parent) => parent,
    }),
  }),
});

export const gambitSimulatorSchema = builder.toSchema();

export const gambitYoga = createYoga<GambitGraphqlContext>({
  schema: gambitSimulatorSchema,
  graphqlEndpoint: "/graphql",
  graphiql: true,
});
