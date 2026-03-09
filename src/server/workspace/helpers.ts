import type {
  ModelMessage,
  SavedState,
  TraceEvent,
} from "@bolt-foundry/gambit-core";
import type { ZodTypeAny } from "zod";
import type { TestBotInitFill, TestBotRunStatus } from "./types.ts";

export const GAMBIT_TOOL_RESPOND = "gambit_respond";

export type RespondSummary = {
  status?: number;
  code?: string;
  message?: string;
  meta?: Record<string, unknown>;
  payload?: unknown;
  displayText: string;
};

export const stringifyContent = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const safeParseJson = (text: string | null | undefined): unknown => {
  if (typeof text !== "string" || text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const summarizeRespondCall = (
  message: ModelMessage | null | undefined,
): RespondSummary | null => {
  if (!message || message.role !== "tool") return null;
  const name = typeof message.name === "string" ? message.name : undefined;
  if (name !== GAMBIT_TOOL_RESPOND) return null;
  const parsed = safeParseJson(
    typeof message.content === "string" ? message.content : "",
  ) as Record<string, unknown> | undefined;
  const payload = parsed && typeof parsed === "object"
    ? ("payload" in parsed ? (parsed as { payload?: unknown }).payload : parsed)
    : undefined;
  const status = typeof parsed?.status === "number"
    ? parsed.status as number
    : undefined;
  const code = typeof parsed?.code === "string"
    ? parsed.code as string
    : undefined;
  const respondMessage = typeof parsed?.message === "string"
    ? parsed.message as string
    : undefined;
  const meta = parsed && typeof parsed.meta === "object"
    ? parsed.meta as Record<string, unknown>
    : undefined;
  const summary: Record<string, unknown> = {};
  if (status !== undefined) summary.status = status;
  if (code !== undefined) summary.code = code;
  if (respondMessage !== undefined) summary.message = respondMessage;
  if (meta !== undefined) summary.meta = meta;
  summary.payload = payload ?? null;
  return {
    status,
    code,
    message: respondMessage,
    meta,
    payload,
    displayText: JSON.stringify(summary, null, 2),
  };
};

export const deriveToolInsertsFromTraces = (
  state: SavedState,
  messageCount: number,
): NonNullable<TestBotRunStatus["toolInserts"]> => {
  const traces = Array.isArray(state.traces) ? state.traces : [];
  if (!traces.length) return [];
  const inserts: NonNullable<TestBotRunStatus["toolInserts"]> = [];
  let messageIndex = 0;
  for (const trace of traces as Array<TraceEvent>) {
    if (!trace || typeof trace !== "object") continue;
    const traceRecord = trace as Record<string, unknown>;
    const type = typeof traceRecord.type === "string" ? traceRecord.type : "";
    if (type === "message.user" || type === "model.result") {
      messageIndex++;
      continue;
    }
    if (type === "tool.call") {
      const actionCallId = typeof traceRecord.actionCallId === "string"
        ? traceRecord.actionCallId
        : undefined;
      const parentActionCallId =
        typeof traceRecord.parentActionCallId === "string"
          ? traceRecord.parentActionCallId
          : undefined;
      const name = typeof traceRecord.name === "string"
        ? traceRecord.name
        : undefined;
      inserts.push({
        actionCallId,
        parentActionCallId,
        name,
        index: Math.min(messageIndex, messageCount),
      });
    }
  }
  return inserts;
};

export const buildTestBotSnapshot = (
  state: SavedState,
): {
  messages: TestBotRunStatus["messages"];
  toolInserts: NonNullable<TestBotRunStatus["toolInserts"]>;
} => {
  const rawMessages = state.messages ?? [];
  const refs = state.messageRefs ?? [];
  const feedbackByRef = new Map(
    state.feedback?.map((entry) => [entry.messageRefId, entry]) ?? [],
  );
  const messages: TestBotRunStatus["messages"] = [];
  const fallbackToolInserts: NonNullable<TestBotRunStatus["toolInserts"]> = [];
  const meta = state.meta && typeof state.meta === "object"
    ? state.meta as Record<string, unknown>
    : {};
  const scope = typeof meta.scenarioRunMode === "string"
    ? meta.scenarioRunMode
    : undefined;
  let effectiveStartIndex = 0;
  if (scope === "scenario" && rawMessages.length > 0) {
    const firstScenarioUserIndex = refs.findIndex((ref) =>
      ref?.source === "scenario"
    );
    if (firstScenarioUserIndex > 0) {
      effectiveStartIndex = firstScenarioUserIndex;
      while (effectiveStartIndex > 0) {
        const priorIndex = effectiveStartIndex - 1;
        const priorMessage = rawMessages[priorIndex];
        const priorSource = refs[priorIndex]?.source;
        if (
          priorMessage?.role === "assistant" &&
          (priorSource === "scenario" || priorSource === "manual")
        ) {
          effectiveStartIndex = priorIndex;
          continue;
        }
        break;
      }
    }
  }
  for (let i = effectiveStartIndex; i < rawMessages.length; i++) {
    const msg = rawMessages[i];
    const refId = refs[i]?.id;
    if (msg?.role === "assistant" || msg?.role === "user") {
      const content = stringifyContent(msg.content).trim();
      if (!content) continue;
      messages.push({
        role: msg.role,
        content,
        messageRefId: refId,
        messageSource: refs[i]?.source === "scenario" ||
            refs[i]?.source === "manual" ||
            refs[i]?.source === "artifact"
          ? refs[i].source
          : undefined,
        feedback: refId ? feedbackByRef.get(refId) : undefined,
      });
      continue;
    }
    const respondSummary = summarizeRespondCall(msg);
    if (respondSummary) {
      messages.push({
        role: "assistant",
        content: respondSummary.displayText,
        messageRefId: refId,
        messageSource: refs[i]?.source === "scenario" ||
            refs[i]?.source === "manual" ||
            refs[i]?.source === "artifact"
          ? refs[i].source
          : undefined,
        feedback: refId ? feedbackByRef.get(refId) : undefined,
        respondStatus: respondSummary.status,
        respondCode: respondSummary.code,
        respondMessage: respondSummary.message,
        respondPayload: respondSummary.payload,
        respondMeta: respondSummary.meta,
      });
      continue;
    }
    if (msg?.role === "tool") {
      const actionCallId =
        typeof (msg as { tool_call_id?: unknown }).tool_call_id === "string"
          ? (msg as { tool_call_id?: string }).tool_call_id
          : undefined;
      const name = typeof msg.name === "string" ? msg.name : undefined;
      fallbackToolInserts.push({
        actionCallId,
        name,
        index: messages.length,
      });
    }
  }
  const traceToolInserts = deriveToolInsertsFromTraces(
    state,
    messages.length,
  );
  return {
    messages,
    toolInserts: traceToolInserts.length > 0
      ? traceToolInserts
      : fallbackToolInserts,
  };
};

export const buildScenarioConversationArtifacts = (
  state: SavedState,
): {
  messages: Array<ModelMessage>;
  assistantTurns: Array<{
    conversationIndex: number;
    message: ModelMessage;
    messageRefId?: string;
  }>;
} => {
  const rawMessages = state.messages ?? [];
  const refs = state.messageRefs ?? [];
  const conversation: Array<ModelMessage> = [];
  const assistantTurns: Array<{
    conversationIndex: number;
    message: ModelMessage;
    messageRefId?: string;
  }> = [];
  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];
    const messageRefId = typeof refs[i]?.id === "string"
      ? refs[i].id
      : undefined;
    if (msg?.role === "assistant" || msg?.role === "user") {
      const content = stringifyContent(msg.content).trim();
      if (!content) continue;
      const nextMessage: ModelMessage = {
        role: msg.role,
        content,
        name: msg.name,
        tool_calls: msg.tool_calls,
      };
      const conversationIndex = conversation.length;
      conversation.push(nextMessage);
      if (nextMessage.role === "assistant") {
        assistantTurns.push({
          conversationIndex,
          message: nextMessage,
          messageRefId,
        });
      }
      continue;
    }
    const respondSummary = summarizeRespondCall(msg);
    if (respondSummary) {
      const nextMessage: ModelMessage = {
        role: "assistant",
        content: respondSummary.displayText,
        name: GAMBIT_TOOL_RESPOND,
      };
      const conversationIndex = conversation.length;
      conversation.push(nextMessage);
      assistantTurns.push({
        conversationIndex,
        message: nextMessage,
        messageRefId,
      });
    }
  }
  return { messages: conversation, assistantTurns };
};

export const buildScenarioConversationArtifactsFromRun = (
  run: {
    messages: Array<{
      role: string;
      content: string;
      messageRefId?: string;
    }>;
  },
): {
  messages: Array<ModelMessage>;
  assistantTurns: Array<{
    conversationIndex: number;
    message: ModelMessage;
    messageRefId?: string;
  }>;
} => {
  const conversation: Array<ModelMessage> = [];
  const assistantTurns: Array<{
    conversationIndex: number;
    message: ModelMessage;
    messageRefId?: string;
  }> = [];
  const runMessages = Array.isArray(run.messages) ? run.messages : [];
  for (const msg of runMessages) {
    if (msg?.role !== "assistant" && msg?.role !== "user") continue;
    const content = typeof msg.content === "string" ? msg.content.trim() : "";
    if (!content) continue;
    const nextMessage: ModelMessage = {
      role: msg.role,
      content,
    };
    const conversationIndex = conversation.length;
    conversation.push(nextMessage);
    if (nextMessage.role === "assistant") {
      assistantTurns.push({
        conversationIndex,
        message: nextMessage,
        messageRefId: msg.messageRefId,
      });
    }
  }
  return { messages: conversation, assistantTurns };
};

export const gradeSchemaHasField = (
  schema: ZodTypeAny | undefined,
  field: string,
): boolean => {
  if (!schema) return false;
  let current: ZodTypeAny = schema;
  while (current && typeof current === "object") {
    const def =
      (current as { _def?: { typeName?: string; [k: string]: unknown } })._def;
    const typeName = def?.typeName;
    if (
      typeName === "ZodOptional" || typeName === "ZodNullable" ||
      typeName === "ZodDefault"
    ) {
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodEffects") {
      current = (def as { schema: ZodTypeAny }).schema;
      continue;
    }
    if (typeName === "ZodCatch") {
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodBranded") {
      current = (def as { type: ZodTypeAny }).type;
      continue;
    }
    break;
  }
  const def = (current as { _def?: { typeName?: string; shape?: unknown } })
    ._def;
  if (def?.typeName !== "ZodObject") return false;
  const shape = typeof def.shape === "function" ? def.shape() : def.shape;
  return Boolean(shape && typeof shape === "object" && field in shape);
};

export const applyUserMessageRefSource = (
  previousState: SavedState | undefined,
  nextState: SavedState,
  source: "scenario" | "manual",
): SavedState => {
  if (
    !Array.isArray(nextState.messages) ||
    !Array.isArray(nextState.messageRefs)
  ) {
    return nextState;
  }
  const startIndex = Math.max(0, previousState?.messages?.length ?? 0);
  const nextRefs = [...nextState.messageRefs];
  let changed = false;
  for (let idx = startIndex; idx < nextState.messages.length; idx++) {
    const msg = nextState.messages[idx];
    if (!msg || msg.role !== "user") continue;
    const ref = nextRefs[idx];
    if (!ref || typeof ref.id !== "string") continue;
    if (ref.source === source) continue;
    nextRefs[idx] = { ...ref, source };
    changed = true;
  }
  if (!changed) return nextState;
  return { ...nextState, messageRefs: nextRefs };
};

export const syncTestBotRunFromState = (
  run: TestBotRunStatus,
  state: SavedState,
) => {
  const snapshot = buildTestBotSnapshot(state);
  run.messages = snapshot.messages;
  run.toolInserts = snapshot.toolInserts;
  const workspaceId = typeof state.meta?.workspaceId === "string"
    ? state.meta.workspaceId
    : typeof state.meta?.sessionId === "string"
    ? state.meta.sessionId
    : undefined;
  if (workspaceId) {
    run.workspaceId = workspaceId;
    run.sessionId = workspaceId;
  }
  const initFill =
    (state.meta as { testBotInitFill?: TestBotInitFill } | undefined)
      ?.testBotInitFill;
  if (initFill) run.initFill = initFill;
  run.traces = Array.isArray(state.traces) ? [...state.traces] : undefined;
};
