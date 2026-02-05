import * as path from "@std/path";
import {
  DEFAULT_GUARDRAILS,
  DEFAULT_STATUS_DELAY_MS,
  GAMBIT_TOOL_COMPLETE,
  GAMBIT_TOOL_CONTEXT,
  GAMBIT_TOOL_END,
  GAMBIT_TOOL_INIT,
  GAMBIT_TOOL_RESPOND,
} from "./constants.ts";
import { loadDeck } from "./loader.ts";
import { assertZodSchema, toJsonSchema, validateWithSchema } from "./schema.ts";
import type {
  ExecutionContext,
  Guardrails,
  JSONValue,
  LoadedDeck,
  ModelMessage,
  ModelProvider,
  ResponseItem,
  ResponseToolDefinition,
  ToolCallResult,
  ToolDefinition,
} from "./types.ts";
import type { MessageRef, SavedState } from "./state.ts";

export type GambitEndSignal = {
  __gambitEnd: true;
  payload?: unknown;
  status?: number;
  message?: string;
  code?: string;
  meta?: Record<string, unknown>;
};

export function isGambitEndSignal(value: unknown): value is GambitEndSignal {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { __gambitEnd?: unknown }).__gambitEnd === true,
  );
}

const logger = console;

function randomId(prefix: string) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  // Keep IDs short enough for OpenAI/OpenRouter tool_call id limits (~40 chars).
  return `${prefix}-${suffix}`;
}

type IdleController = {
  touch: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

type RunOptions = {
  path: string;
  input: unknown;
  inputProvided?: boolean;
  initialUserMessage?: unknown;
  modelProvider: ModelProvider;
  isRoot?: boolean;
  guardrails?: Partial<Guardrails>;
  depth?: number;
  parentActionCallId?: string;
  runId?: string;
  defaultModel?: string;
  modelOverride?: string;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  repl?: boolean;
  stream?: boolean;
  state?: SavedState;
  onStateUpdate?: (state: SavedState) => void;
  onStreamText?: (chunk: string) => void;
  allowRootStringInput?: boolean;
  responsesMode?: boolean;
};

export async function runDeck(opts: RunOptions): Promise<unknown> {
  const guardrails: Guardrails = {
    ...DEFAULT_GUARDRAILS,
    ...opts.guardrails,
  };
  const depth = opts.depth ?? 0;
  const inferredRoot = opts.isRoot ??
    (!opts.parentActionCallId && depth === 0);
  if (depth >= guardrails.maxDepth) {
    throw new Error(`Max depth ${guardrails.maxDepth} exceeded`);
  }
  const runId = opts.runId ?? opts.state?.runId ?? randomId("run");

  const deck = await loadDeck(opts.path);
  const deckGuardrails = deck.guardrails ?? {};
  const effectiveGuardrails: Guardrails = {
    ...guardrails,
    ...deckGuardrails,
  };
  const isRoot = Boolean(inferredRoot);

  ensureSchemaPresence(deck, isRoot);

  const resolvedInput = resolveInput({
    deck,
    input: opts.input,
    state: opts.state,
    isRoot,
    initialUserMessage: opts.initialUserMessage,
  });
  const validatedInput = validateInput(
    deck,
    resolvedInput,
    isRoot,
    opts.allowRootStringInput ?? false,
  );
  const shouldEmitRun = opts.depth === undefined || opts.depth === 0;
  if (shouldEmitRun) {
    opts.trace?.({
      type: "run.start",
      runId,
      deckPath: deck.path,
      input: validatedInput as unknown as import("./types.ts").JSONValue,
      initialUserMessage: opts
        .initialUserMessage as unknown as import("./types.ts").JSONValue,
    });
  }
  try {
    if (
      deck.modelParams?.model || deck.modelParams?.temperature !== undefined
    ) {
      return await runLlmDeck({
        deck,
        guardrails: effectiveGuardrails,
        depth,
        runId,
        parentActionCallId: opts.parentActionCallId,
        modelProvider: opts.modelProvider,
        input: validatedInput,
        inputProvided: opts.inputProvided ?? true,
        initialUserMessage: opts.initialUserMessage,
        defaultModel: opts.defaultModel,
        modelOverride: opts.modelOverride,
        trace: opts.trace,
        stream: opts.stream,
        state: opts.state,
        onStateUpdate: opts.onStateUpdate,
        onStreamText: opts.onStreamText,
        responsesMode: opts.responsesMode,
      });
    }

    if (!deck.executor) {
      throw new Error(
        `Deck ${deck.path} has no model and no executor (add run or execute to the deck definition)`,
      );
    }

    return await runComputeDeck({
      deck,
      guardrails: effectiveGuardrails,
      depth,
      runId,
      parentActionCallId: opts.parentActionCallId,
      modelProvider: opts.modelProvider,
      input: validatedInput,
      defaultModel: opts.defaultModel,
      modelOverride: opts.modelOverride,
      trace: opts.trace,
      stream: opts.stream,
      onStreamText: opts.onStreamText,
      responsesMode: opts.responsesMode,
    });
  } finally {
    if (shouldEmitRun) {
      opts.trace?.({ type: "run.end", runId });
    }
  }
}

function toProviderParams(
  params: import("./types.ts").ModelParams | undefined,
): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const {
    model: _model,
    additionalParams,
    temperature,
    top_p,
    frequency_penalty,
    presence_penalty,
    max_tokens,
  } = params;
  const out: Record<string, unknown> = {};
  if (
    additionalParams &&
    typeof additionalParams === "object" &&
    !Array.isArray(additionalParams)
  ) {
    for (const [key, value] of Object.entries(additionalParams)) {
      if (value === undefined) continue;
      out[key] = value;
    }
  }
  if (temperature !== undefined) out.temperature = temperature;
  if (top_p !== undefined) out.top_p = top_p;
  if (frequency_penalty !== undefined) {
    out.frequency_penalty = frequency_penalty;
  }
  if (presence_penalty !== undefined) out.presence_penalty = presence_penalty;
  if (max_tokens !== undefined) out.max_tokens = max_tokens;
  return Object.keys(out).length ? out : undefined;
}

async function resolveModelChoice(args: {
  model: string | Array<string>;
  params?: Record<string, unknown>;
  modelProvider: ModelProvider;
  deckPath: string;
}): Promise<{ model: string; params?: Record<string, unknown> }> {
  const resolver = args.modelProvider.resolveModel;
  if (resolver) {
    return await resolver({
      model: args.model,
      params: args.params,
      deckPath: args.deckPath,
    });
  }
  if (Array.isArray(args.model)) {
    const first = args.model.find((entry) =>
      typeof entry === "string" && entry.trim().length > 0
    );
    if (!first) {
      throw new Error(`No model configured for deck ${args.deckPath}`);
    }
    return { model: first, params: args.params };
  }
  if (!args.model || !args.model.trim()) {
    throw new Error(`No model configured for deck ${args.deckPath}`);
  }
  return { model: args.model, params: args.params };
}

function resolveContextSchema(deck: LoadedDeck) {
  return deck.contextSchema ?? deck.inputSchema;
}

function resolveResponseSchema(deck: LoadedDeck) {
  return deck.responseSchema ?? deck.outputSchema;
}

function isContextToolName(name: string): boolean {
  return name === GAMBIT_TOOL_CONTEXT || name === GAMBIT_TOOL_INIT;
}

function ensureSchemaPresence(deck: LoadedDeck, isRoot: boolean) {
  if (!isRoot) {
    const contextSchema = resolveContextSchema(deck);
    const responseSchema = resolveResponseSchema(deck);
    if (!contextSchema || !responseSchema) {
      throw new Error(
        `Deck ${deck.path} must declare contextSchema and responseSchema (non-root)`,
      );
    }
    assertZodSchema(contextSchema, "contextSchema");
    assertZodSchema(responseSchema, "responseSchema");
  }
}

function resolveInput(args: {
  deck: LoadedDeck;
  input: unknown;
  state?: SavedState;
  isRoot: boolean;
  initialUserMessage?: unknown;
}) {
  if (args.input !== undefined) return args.input;
  if (!args.isRoot) return args.input;

  const persisted = extractContextInput(args.state);
  if (persisted !== undefined) return persisted;

  if (args.initialUserMessage !== undefined) {
    const schema = resolveContextSchema(args.deck) as {
      safeParse?: (v: unknown) => {
        success: boolean;
        data?: unknown;
      };
    } | undefined;
    if (schema?.safeParse) {
      const candidates: Array<unknown> = [undefined, {}, ""];
      for (const candidate of candidates) {
        try {
          const result = schema.safeParse(candidate);
          if (result?.success) return candidate;
        } catch {
          // ignore and try next candidate
        }
      }
    }
    return "";
  }

  return args.input;
}

function extractContextInput(state?: SavedState): unknown {
  if (!state) return undefined;
  if (state.format === "responses" && Array.isArray(state.items)) {
    return extractContextInputFromItems(state.items);
  }
  if (!state.messages) return undefined;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i];
    if (msg.role === "tool" && isContextToolName(msg.name ?? "")) {
      const content = msg.content;
      if (typeof content !== "string") return undefined;
      try {
        return JSON.parse(content);
      } catch {
        return content;
      }
    }
  }
  return undefined;
}

function extractContextInputFromItems(items: Array<ResponseItem>): unknown {
  const contextToolNames = new Set([GAMBIT_TOOL_CONTEXT, GAMBIT_TOOL_INIT]);
  const callNameById = new Map<string, string>();
  for (const item of items) {
    if (item.type === "function_call") {
      callNameById.set(item.call_id, item.name);
    }
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type !== "function_call_output") continue;
    const name = callNameById.get(item.call_id);
    if (!name || !contextToolNames.has(name)) continue;
    try {
      return JSON.parse(item.output);
    } catch {
      return item.output;
    }
  }
  return undefined;
}

function messagesFromResponseItems(
  items: Array<ResponseItem>,
): Array<ModelMessage> {
  const messages: Array<ModelMessage> = [];
  const callNameById = new Map<string, string>();
  for (const item of items) {
    if (item.type === "message") {
      const text = item.content.map((part) => part.text).join("");
      messages.push({
        role: item.role,
        content: text || null,
      });
      continue;
    }
    if (item.type === "function_call") {
      callNameById.set(item.call_id, item.name);
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        }],
      });
      continue;
    }
    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        name: callNameById.get(item.call_id),
        tool_call_id: item.call_id,
        content: item.output,
      });
    }
  }
  return messages;
}

function responseItemsFromMessages(
  messages: Array<ModelMessage>,
): Array<ResponseItem> {
  const items: Array<ResponseItem> = [];
  for (const message of messages) {
    if (message.role === "tool") {
      if (!message.tool_call_id || message.content === null) continue;
      items.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: String(message.content),
      });
      continue;
    }
    const contentText = message.content ?? "";
    if (typeof contentText === "string" && contentText.length > 0) {
      items.push({
        type: "message",
        role: message.role,
        content: [{
          type: message.role === "assistant" ? "output_text" : "input_text",
          text: contentText,
        }],
      });
    }
    if (message.role === "assistant" && message.tool_calls) {
      for (const call of message.tool_calls) {
        items.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
    }
  }
  return items;
}

function safeJsonArgs(value: string): Record<string, JSONValue> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, JSONValue>;
    }
  } catch {
    // ignore
  }
  return {};
}

function mapResponseOutput(
  output: Array<ResponseItem>,
): {
  message: ModelMessage;
  toolCalls?: Array<
    { id: string; name: string; args: Record<string, JSONValue> }
  >;
} {
  const toolCalls: Array<
    { id: string; name: string; args: Record<string, JSONValue> }
  > = [];
  const textParts: Array<string> = [];
  for (const item of output) {
    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id,
        name: item.name,
        args: safeJsonArgs(item.arguments),
      });
      continue;
    }
    if (item.type === "message" && item.role === "assistant") {
      for (const part of item.content) {
        if (part.type === "output_text") {
          textParts.push(part.text);
        }
      }
    }
  }
  return {
    message: {
      role: "assistant",
      content: textParts.length ? textParts.join("") : null,
    },
    toolCalls: toolCalls.length ? toolCalls : undefined,
  };
}

function validateInput(
  deck: LoadedDeck,
  input: unknown,
  isRoot: boolean,
  allowRootStringInput: boolean,
) {
  const contextSchema = resolveContextSchema(deck);
  if (contextSchema) {
    if (isRoot && typeof input === "string" && allowRootStringInput) {
      try {
        return validateWithSchema(contextSchema as never, input);
      } catch {
        return input;
      }
    }
    return validateWithSchema(contextSchema as never, input);
  }
  if (isRoot) {
    if (input === undefined) return "";
    if (typeof input === "string") return input;
    return input;
  }
  throw new Error(`Deck ${deck.path} requires contextSchema (non-root)`);
}

function validateOutput(
  deck: LoadedDeck,
  output: unknown,
  isRoot: boolean,
): unknown {
  const responseSchema = resolveResponseSchema(deck);
  if (responseSchema) {
    return validateWithSchema(responseSchema as never, output);
  }
  if (isRoot) {
    if (typeof output === "string") return output;
    return JSON.stringify(output);
  }
  throw new Error(`Deck ${deck.path} requires responseSchema (non-root)`);
}

type RuntimeCtxBase = {
  deck: LoadedDeck;
  guardrails: Guardrails;
  depth: number;
  runId: string;
  inputProvided?: boolean;
  parentActionCallId?: string;
  modelProvider: ModelProvider;
  input: unknown;
  defaultModel?: string;
  modelOverride?: string;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  stream?: boolean;
  state?: SavedState;
  onStateUpdate?: (state: SavedState) => void;
  onStreamText?: (chunk: string) => void;
  responsesMode?: boolean;
};

async function runComputeDeck(ctx: RuntimeCtxBase): Promise<unknown> {
  const { deck, runId } = ctx;
  const actionCallId = randomId("action");

  const execContext: ExecutionContext = {
    runId,
    actionCallId,
    parentActionCallId: ctx.parentActionCallId,
    depth: ctx.depth,
    input: ctx.input,
    label: deck.label,
    log: (entry) => {
      if (!ctx.trace) return;
      const raw = typeof entry === "string" ? { message: entry } : entry;
      if (!raw) return;

      const message = typeof raw.message === "string"
        ? raw.message
        : raw.message !== undefined
        ? String(raw.message)
        : typeof entry === "string"
        ? entry
        : "";

      const title = typeof raw.title === "string" ? raw.title : undefined;
      const body = raw.body ?? raw.message ?? message;

      ctx.trace({
        type: "log",
        runId,
        deckPath: deck.path,
        actionCallId,
        parentActionCallId: ctx.parentActionCallId,
        level: raw.level ?? "info",
        title: title ?? (message || undefined),
        message,
        body,
        meta: raw.meta,
      });
    },
    spawnAndWait: async (opts) => {
      const childPath = path.isAbsolute(opts.path)
        ? opts.path
        : path.resolve(path.dirname(deck.path), opts.path);
      return await runDeck({
        path: childPath,
        input: opts.input,
        modelProvider: ctx.modelProvider,
        isRoot: false,
        guardrails: ctx.guardrails,
        depth: ctx.depth + 1,
        parentActionCallId: actionCallId,
        runId,
        defaultModel: ctx.defaultModel,
        modelOverride: ctx.modelOverride,
        trace: ctx.trace,
        stream: ctx.stream,
        state: ctx.state,
        onStateUpdate: ctx.onStateUpdate,
        onStreamText: ctx.onStreamText,
        responsesMode: ctx.responsesMode,
        initialUserMessage: undefined,
        inputProvided: true,
      });
    },
    fail: (opts) => {
      throw new Error(opts.message);
    },
    return: (payload) => Promise.resolve(payload),
  };

  const raw = await deck.executor!(execContext);
  return validateOutput(deck, raw, ctx.depth === 0);
}

async function runLlmDeck(
  ctx: RuntimeCtxBase & {
    initialUserMessage?: unknown;
  },
): Promise<unknown> {
  const {
    deck,
    guardrails,
    depth,
    modelProvider,
    input,
    runId,
    inputProvided,
    initialUserMessage,
  } = ctx;
  const actionCallId = randomId("action");
  const start = performance.now();
  const respondEnabled = Boolean(deck.respond);
  const useResponses = Boolean(ctx.responsesMode) ||
    ctx.state?.format === "responses";

  const systemPrompt = buildSystemPrompt(deck);

  const refToolCallId = randomId("call");
  const messages: Array<ModelMessage> = ctx.state?.messages?.length
    ? ctx.state.messages.map(sanitizeMessage)
    : ctx.state?.items?.length
    ? messagesFromResponseItems(ctx.state.items).map(sanitizeMessage)
    : [];
  const resumed = messages.length > 0;
  const sendContext = Boolean(inputProvided) && input !== undefined && !resumed;
  const idleController = createIdleController({
    cfg: deck.handlers?.onIdle,
    deck,
    guardrails,
    depth,
    runId,
    parentActionCallId: ctx.parentActionCallId,
    modelProvider,
    defaultModel: ctx.defaultModel,
    modelOverride: ctx.modelOverride,
    trace: ctx.trace,
    stream: ctx.stream,
    onStreamText: ctx.onStreamText,
    pushMessages: (msgs) => messages.push(...msgs.map(sanitizeMessage)),
    responsesMode: ctx.responsesMode,
  });
  let streamingBuffer = "";
  let streamingCommitted = false;
  const wrappedOnStreamText = (chunk: string) => {
    if (!chunk) return;
    idleController.touch();
    streamingBuffer += chunk;
    ctx.onStreamText?.(chunk);
  };
  if (!resumed) {
    messages.push(sanitizeMessage({ role: "system", content: systemPrompt }));
    if (sendContext) {
      ctx.trace?.({
        type: "tool.call",
        runId,
        actionCallId: refToolCallId,
        name: GAMBIT_TOOL_CONTEXT,
        args: {},
        parentActionCallId: actionCallId,
      });
      messages.push(
        sanitizeMessage({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: refToolCallId,
            type: "function",
            function: {
              name: GAMBIT_TOOL_CONTEXT,
              arguments: "{}",
            },
          }],
        }),
        sanitizeMessage({
          role: "tool",
          name: GAMBIT_TOOL_CONTEXT,
          tool_call_id: refToolCallId,
          content: JSON.stringify(input),
        }),
      );
      ctx.trace?.({
        type: "tool.result",
        runId,
        actionCallId: refToolCallId,
        name: GAMBIT_TOOL_CONTEXT,
        result: input as unknown as import("./types.ts").JSONValue,
        parentActionCallId: actionCallId,
      });
    }
  }

  if (initialUserMessage !== undefined) {
    const userMessage = sanitizeMessage({
      role: "user",
      content: formatInputForUser(initialUserMessage),
    });
    messages.push(userMessage);
    ctx.trace?.({
      type: "message.user",
      runId,
      actionCallId,
      deckPath: deck.path,
      message: userMessage,
      parentActionCallId: ctx.parentActionCallId,
    });
  }
  idleController.touch();

  const tools = await buildToolDefs(deck);
  ctx.trace?.({
    type: "deck.start",
    runId,
    deckPath: deck.path,
    actionCallId,
    parentActionCallId: ctx.parentActionCallId,
  });
  let passes = 0;
  try {
    while (passes < guardrails.maxPasses) {
      passes++;
      if (performance.now() - start > guardrails.timeoutMs) {
        throw new Error("Timeout exceeded");
      }
      streamingBuffer = "";
      streamingCommitted = false;
      const modelCandidate = ctx.modelOverride ??
        deck.modelParams?.model ??
        ctx.defaultModel ??
        (() => {
          throw new Error(
            `No model configured for deck ${deck.path} and no --model provided`,
          );
        })();
      const resolved = await resolveModelChoice({
        model: modelCandidate,
        params: toProviderParams(deck.modelParams),
        modelProvider,
        deckPath: deck.path,
      });
      const model = resolved.model;
      const providerParams = resolved.params;

      const stateMessages = ctx.state?.messages?.length;
      ctx.trace?.({
        type: "model.call",
        runId,
        actionCallId,
        deckPath: deck.path,
        model,
        stream: ctx.stream,
        messageCount: messages.length,
        toolCount: tools.length,
        messages: messages.map(sanitizeMessage),
        tools,
        stateMessages,
        mode: useResponses ? "responses" : "chat",
        responseItems: useResponses
          ? responseItemsFromMessages(messages)
          : undefined,
        parentActionCallId: ctx.parentActionCallId,
      });

      let responseOutputItems: Array<ResponseItem> | undefined;
      const responses = modelProvider.responses;
      type ModelCallResult = Awaited<ReturnType<ModelProvider["chat"]>>;
      const result: ModelCallResult = (useResponses && responses)
        ? await (async () => {
          const responseItems = responseItemsFromMessages(messages);
          let sawDelta = false;
          const response = await responses({
            request: {
              model,
              input: responseItems,
              tools: tools as Array<ResponseToolDefinition>,
              stream: ctx.stream,
              params: providerParams,
            },
            state: ctx.state,
            onStreamEvent: (ctx.onStreamText || deck.handlers?.onIdle)
              ? (event) => {
                if (event.type === "response.output_text.delta") {
                  sawDelta = true;
                  wrappedOnStreamText(event.delta);
                } else if (
                  event.type === "response.output_text.done" && !sawDelta
                ) {
                  wrappedOnStreamText(event.text);
                }
              }
              : undefined,
          });
          responseOutputItems = response.output ?? [];
          const mapped = mapResponseOutput(responseOutputItems);
          return {
            message: mapped.message,
            finishReason: mapped.toolCalls?.length ? "tool_calls" : "stop",
            toolCalls: mapped.toolCalls,
            updatedState: undefined,
          };
        })()
        : await modelProvider.chat({
          model,
          messages,
          tools,
          stream: ctx.stream,
          state: ctx.state,
          params: providerParams,
          onStreamText: (ctx.onStreamText || deck.handlers?.onIdle)
            ? wrappedOnStreamText
            : undefined,
        });
      idleController.touch();
      let message = result.message;
      ctx.trace?.({
        type: "model.result",
        runId,
        actionCallId,
        deckPath: deck.path,
        model,
        finishReason: result.finishReason,
        message: sanitizeMessage(message),
        toolCalls: result.toolCalls,
        stateMessages: result.updatedState?.messages?.length,
        mode: useResponses ? "responses" : "chat",
        responseItems: responseOutputItems,
        parentActionCallId: ctx.parentActionCallId,
      });
      const computeState = (updated?: SavedState): SavedState => {
        const base = updated ??
          { runId, messages: messages.map(sanitizeMessage) };
        const mergedMessages = base.messages && base.messages.length > 0
          ? base.messages.map(sanitizeMessage)
          : messages.map(sanitizeMessage);
        const responseItems = useResponses
          ? responseItemsFromMessages(mergedMessages)
          : updated?.items ?? ctx.state?.items;
        const priorRefs = updated?.messageRefs ?? ctx.state?.messageRefs ?? [];
        const messageRefs: Array<MessageRef> = mergedMessages.map((m, idx) =>
          priorRefs[idx] ?? { id: randomId("msg"), role: m.role }
        );
        const feedback = updated?.feedback ?? ctx.state?.feedback;
        const traces = updated?.traces ?? ctx.state?.traces;
        return {
          ...base,
          runId,
          messages: mergedMessages,
          format: useResponses
            ? "responses"
            : updated?.format ?? ctx.state?.format,
          items: responseItems,
          messageRefs,
          feedback,
          traces,
        };
      };

      if (result.toolCalls && result.toolCalls.length > 0) {
        let responded = false;
        let respondValue: unknown;
        let endSignal: GambitEndSignal | undefined;
        const appendedMessages: Array<ModelMessage> = [];
        const toolCallText = streamingBuffer ||
          (typeof message.content === "string" ? message.content : "");
        if (!streamingCommitted && toolCallText) {
          messages.push(
            sanitizeMessage({ role: "assistant", content: toolCallText }),
          );
          streamingCommitted = true;
        }

        for (const call of result.toolCalls) {
          if (respondEnabled && call.name === GAMBIT_TOOL_RESPOND) {
            const status = typeof call.args?.status === "number"
              ? call.args.status
              : undefined;
            const message = typeof call.args?.message === "string"
              ? call.args.message
              : undefined;
            const code = typeof call.args?.code === "string"
              ? call.args.code
              : undefined;
            const meta = (call.args?.meta &&
                typeof call.args.meta === "object" &&
                call.args.meta !== null)
              ? call.args.meta as Record<string, unknown>
              : undefined;
            const rawPayload = call.args?.payload ?? call.args;
            const validatedPayload = validateOutput(
              deck,
              rawPayload,
              depth === 0,
            );
            const respondEnvelope: {
              payload: unknown;
              status?: number;
              message?: string;
              code?: string;
              meta?: Record<string, unknown>;
            } = {
              payload: validatedPayload,
            };
            if (status !== undefined) respondEnvelope.status = status;
            if (message !== undefined) respondEnvelope.message = message;
            if (code !== undefined) respondEnvelope.code = code;
            if (meta !== undefined) respondEnvelope.meta = meta;
            ctx.trace?.({
              type: "tool.call",
              runId,
              actionCallId: call.id,
              name: call.name,
              args: call.args,
              parentActionCallId: actionCallId,
            });
            const toolContent = JSON.stringify(call.args ?? {});
            appendedMessages.push({
              role: "assistant",
              content: null,
              tool_calls: [{
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args ?? {}),
                },
              }],
            });
            appendedMessages.push({
              role: "tool",
              tool_call_id: call.id,
              name: call.name,
              content: toolContent,
            });
            respondValue = respondEnvelope;
            responded = true;
            ctx.trace?.({
              type: "tool.result",
              runId,
              actionCallId: call.id,
              name: call.name,
              result:
                respondEnvelope as unknown as import("./types.ts").JSONValue,
              parentActionCallId: actionCallId,
            });
            continue;
          }

          if (deck.allowEnd && call.name === GAMBIT_TOOL_END) {
            const status = typeof call.args?.status === "number"
              ? call.args.status
              : undefined;
            const messageText = typeof call.args?.message === "string"
              ? call.args.message
              : undefined;
            const code = typeof call.args?.code === "string"
              ? call.args.code
              : undefined;
            const meta = (call.args?.meta &&
                typeof call.args.meta === "object" &&
                call.args.meta !== null)
              ? call.args.meta as Record<string, unknown>
              : undefined;
            const payload = call.args?.payload;
            ctx.trace?.({
              type: "tool.call",
              runId,
              actionCallId: call.id,
              name: call.name,
              args: call.args,
              parentActionCallId: actionCallId,
            });
            const toolContent = JSON.stringify(call.args ?? {});
            appendedMessages.push({
              role: "assistant",
              content: null,
              tool_calls: [{
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args ?? {}),
                },
              }],
            });
            appendedMessages.push({
              role: "tool",
              tool_call_id: call.id,
              name: call.name,
              content: toolContent,
            });
            const signal: GambitEndSignal = { __gambitEnd: true };
            if (status !== undefined) signal.status = status;
            if (messageText !== undefined) signal.message = messageText;
            if (code !== undefined) signal.code = code;
            if (meta !== undefined) signal.meta = meta;
            if (payload !== undefined) signal.payload = payload;
            endSignal = signal;
            ctx.trace?.({
              type: "tool.result",
              runId,
              actionCallId: call.id,
              name: call.name,
              result: signal as unknown as import("./types.ts").JSONValue,
              parentActionCallId: actionCallId,
            });
            continue;
          }

          ctx.trace?.({
            type: "action.start",
            runId,
            actionCallId: call.id,
            name: call.name,
            path: call.name,
            parentActionCallId: actionCallId,
          });
          ctx.trace?.({
            type: "tool.call",
            runId,
            actionCallId: call.id,
            name: call.name,
            args: call.args,
            parentActionCallId: actionCallId,
          });
          const toolResult = await handleToolCall(call, {
            parentDeck: deck,
            modelProvider,
            guardrails,
            depth,
            runId,
            parentActionCallId: actionCallId,
            defaultModel: ctx.defaultModel,
            modelOverride: ctx.modelOverride,
            trace: ctx.trace,
            onStreamText: (ctx.onStreamText || deck.handlers?.onIdle)
              ? wrappedOnStreamText
              : undefined,
            runStartedAt: start,
            inputProvided: true,
            idle: idleController,
            responsesMode: ctx.responsesMode,
          });
          ctx.trace?.({
            type: "tool.result",
            runId,
            actionCallId: call.id,
            name: call.name,
            result: toolResult.toolContent,
            parentActionCallId: actionCallId,
          });
          appendedMessages.push({
            role: "assistant",
            content: null,
            tool_calls: [{
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            }],
          });
          appendedMessages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: toolResult.toolContent,
          });
          if (toolResult.extraMessages?.length) {
            appendedMessages.push(...toolResult.extraMessages);
          }
          ctx.trace?.({
            type: "action.end",
            runId,
            actionCallId: call.id,
            name: call.name,
            path: call.name,
            parentActionCallId: actionCallId,
          });
        }

        if (appendedMessages.length) {
          messages.push(...appendedMessages.map(sanitizeMessage));
          idleController.touch();
        }
        if (ctx.onStateUpdate) {
          const state = computeState(result.updatedState);
          ctx.onStateUpdate(state);
        }
        if (endSignal) {
          ctx.trace?.({
            type: "deck.end",
            runId,
            deckPath: deck.path,
            actionCallId,
            parentActionCallId: ctx.parentActionCallId,
          });
          return endSignal;
        }
        if (responded) {
          ctx.trace?.({
            type: "deck.end",
            runId,
            deckPath: deck.path,
            actionCallId,
            parentActionCallId: ctx.parentActionCallId,
          });
          return respondValue;
        }
        continue;
      }

      if (
        !respondEnabled &&
        result.finishReason === "stop" &&
        (message.content === null || message.content === undefined) &&
        (!result.toolCalls || result.toolCalls.length === 0)
      ) {
        message = { ...message, content: "" };
      }

      if (result.finishReason === "tool_calls") {
        throw new Error("Model requested tool_calls but provided none");
      }

      if (
        result.finishReason === "length" &&
        (message.content === null || message.content === undefined)
      ) {
        throw new Error("Model stopped early (length) with no content");
      }

      if (message.content !== null && message.content !== undefined) {
        messages.push(sanitizeMessage(message));
        if (ctx.onStateUpdate) {
          const state = computeState(result.updatedState);
          ctx.onStateUpdate(state);
        }
        if (
          ctx.parentActionCallId !== undefined &&
          (!result.toolCalls || result.toolCalls.length === 0)
        ) {
          ctx.trace?.({
            type: "monolog",
            runId,
            deckPath: deck.path,
            actionCallId,
            parentActionCallId: ctx.parentActionCallId,
            content: message
              .content as unknown as import("./types.ts").JSONValue,
          });
        }
        if (!respondEnabled) {
          const validated = validateOutput(deck, message.content, depth === 0);
          ctx.trace?.({
            type: "deck.end",
            runId,
            deckPath: deck.path,
            actionCallId,
            parentActionCallId: ctx.parentActionCallId,
          });
          return validated;
        }
      }

      if (respondEnabled && result.finishReason === "stop") {
        continue;
      }

      if (passes >= guardrails.maxPasses) {
        throw new Error("Max passes exceeded without completing");
      }
    }
  } finally {
    idleController.stop();
  }

  throw new Error("Model did not complete within guardrails");
}

async function handleToolCall(
  call: { id: string; name: string; args: Record<string, unknown> },
  ctx: {
    parentDeck: LoadedDeck;
    guardrails: Guardrails;
    depth: number;
    runId: string;
    parentActionCallId?: string;
    modelProvider: ModelProvider;
    defaultModel?: string;
    modelOverride?: string;
    trace?: (event: import("./types.ts").TraceEvent) => void;
    stream?: boolean;
    onStreamText?: (chunk: string) => void;
    runStartedAt: number;
    inputProvided?: boolean;
    idle?: IdleController;
    responsesMode?: boolean;
  },
): Promise<ToolCallResult> {
  const action = ctx.parentDeck.actionDecks.find((a) => a.name === call.name);
  const source = {
    deckPath: ctx.parentDeck.path,
    actionName: action?.name ?? call.name,
  };
  if (!action) {
    return {
      toolContent: JSON.stringify({
        runId: ctx.runId,
        actionCallId: call.id,
        parentActionCallId: ctx.parentActionCallId,
        source,
        status: 404,
        message: "unknown action",
      }),
    };
  }

  const baseComplete = (payload: {
    status?: number;
    payload?: unknown;
    message?: string;
    code?: string;
    meta?: Record<string, unknown>;
  }) =>
    JSON.stringify({
      runId: ctx.runId,
      actionCallId: call.id,
      parentActionCallId: ctx.parentActionCallId,
      source,
      status: payload.status,
      payload: payload.payload,
      message: payload.message,
      code: payload.code,
      meta: payload.meta,
    });
  const extraMessages: Array<ModelMessage> = [];
  const started = performance.now();

  const busyCfg = ctx.parentDeck.handlers?.onBusy ??
    ctx.parentDeck.handlers?.onInterval;
  const busyDelay = busyCfg?.delayMs ?? DEFAULT_STATUS_DELAY_MS;
  const busyRepeat = busyCfg?.repeatMs;

  let busyTimer: number | undefined;
  let busyFired = false;
  let busyStopped = false;
  let nextBusyAt = busyCfg?.path ? performance.now() + busyDelay : 0;

  ctx.idle?.pause();

  const childPromise = (async () => {
    try {
      const result = await runDeck({
        path: action.path,
        input: call.args,
        modelProvider: ctx.modelProvider,
        isRoot: false,
        guardrails: ctx.guardrails,
        depth: ctx.depth + 1,
        parentActionCallId: call.id,
        runId: ctx.runId,
        defaultModel: ctx.defaultModel,
        modelOverride: ctx.modelOverride,
        trace: ctx.trace,
        stream: ctx.stream,
        onStreamText: ctx.onStreamText,
        responsesMode: ctx.responsesMode,
        initialUserMessage: undefined,
      });
      return { ok: true, result };
    } catch (err) {
      return { ok: false as const, error: err };
    } finally {
      // Keep busy timers alive until the caller explicitly stops them
    }
  })();

  const triggerBusy = async (elapsed: number) => {
    if (busyStopped) return;
    busyFired = true;
    try {
      const envelope = await runBusyHandler({
        parentDeck: ctx.parentDeck,
        action,
        call,
        runId: ctx.runId,
        parentActionCallId: ctx.parentActionCallId,
        handlerPath: busyCfg!.path,
        modelProvider: ctx.modelProvider,
        guardrails: ctx.guardrails,
        depth: ctx.depth,
        defaultModel: ctx.defaultModel,
        modelOverride: ctx.modelOverride,
        elapsedMs: elapsed,
        trace: ctx.trace,
        stream: ctx.stream,
        onStreamText: ctx.onStreamText,
        responsesMode: ctx.responsesMode,
        initialUserMessage: undefined,
      });
      if (envelope.length) {
        extraMessages.push(...envelope.map(sanitizeMessage));
      }
      ctx.idle?.touch();
    } catch {
      // ignore handler errors
    }
  };

  const scheduleNextBusy = () => {
    if (!busyCfg?.path || busyStopped) return;
    const now = performance.now();
    const delay = Math.max(0, nextBusyAt - now);
    busyTimer = setTimeout(async () => {
      if (busyStopped) return;
      const elapsed = performance.now() - started;
      await triggerBusy(elapsed);
      if (busyRepeat && busyRepeat > 0) {
        nextBusyAt += busyRepeat;
        scheduleNextBusy();
      }
    }, delay) as unknown as number;
  };

  if (busyCfg?.path) {
    scheduleNextBusy();
  }

  const stopBusy = () => {
    busyStopped = true;
    if (busyTimer !== undefined) {
      clearTimeout(busyTimer);
    }
  };

  const childResult = await childPromise;
  ctx.idle?.resume();

  if (!childResult.ok) {
    const handled = await maybeHandleError({
      err: childResult.error,
      call,
      ctx,
      action,
    });
    if (handled) {
      if (handled.extraMessages) {
        extraMessages.push(...handled.extraMessages);
      }
      stopBusy();
      ctx.idle?.touch();
      const content = handled.toolContent;
      return { toolContent: content, extraMessages };
    }

    stopBusy();
    throw childResult.error;
  }

  const normalized = normalizeChildResult(childResult.result);
  const toolContent = baseComplete(normalized);

  if (busyCfg?.path) {
    const elapsedFromAction = performance.now() - started;
    if (!busyFired && elapsedFromAction >= busyDelay) {
      try {
        const envelope = await runBusyHandler({
          parentDeck: ctx.parentDeck,
          action,
          call,
          runId: ctx.runId,
          parentActionCallId: ctx.parentActionCallId,
          handlerPath: busyCfg.path,
          modelProvider: ctx.modelProvider,
          guardrails: ctx.guardrails,
          depth: ctx.depth,
          defaultModel: ctx.defaultModel,
          modelOverride: ctx.modelOverride,
          elapsedMs: elapsedFromAction,
          trace: ctx.trace,
          stream: ctx.stream,
          onStreamText: ctx.onStreamText,
          responsesMode: ctx.responsesMode,
          initialUserMessage: undefined,
        });
        if (envelope.length) {
          extraMessages.push(...envelope.map(sanitizeMessage));
        }
        ctx.idle?.touch();
      } catch {
        // ignore handler errors
      }
    }
  }

  const completeEventId = randomId("event");
  extraMessages.push(
    {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: completeEventId,
        type: "function",
        function: {
          name: GAMBIT_TOOL_COMPLETE,
          arguments: toolContent,
        },
      }],
    },
    {
      role: "tool",
      tool_call_id: completeEventId,
      name: GAMBIT_TOOL_COMPLETE,
      content: toolContent,
    },
  );

  stopBusy();
  ctx.idle?.touch();

  return { toolContent, extraMessages };
}

function normalizeChildResult(
  result: unknown,
): {
  status?: number;
  payload?: unknown;
  message?: string;
  code?: string;
  meta?: Record<string, unknown>;
} {
  if (result && typeof result === "object") {
    const rec = result as Record<string, unknown>;
    const status = typeof rec.status === "number" ? rec.status : undefined;
    const message = typeof rec.message === "string" ? rec.message : undefined;
    const code = typeof rec.code === "string" ? rec.code : undefined;
    const meta = (rec.meta && typeof rec.meta === "object")
      ? rec.meta as Record<string, unknown>
      : undefined;
    const payload = rec.payload ?? result;
    return { status, payload, message, code, meta };
  }
  return { payload: result };
}

async function runBusyHandler(args: {
  parentDeck: LoadedDeck;
  action: { name: string; path: string; label?: string; description?: string };
  call: { id: string; name: string; args: Record<string, unknown> };
  runId: string;
  parentActionCallId?: string;
  handlerPath: string;
  modelProvider: ModelProvider;
  guardrails: Guardrails;
  depth: number;
  defaultModel?: string;
  modelOverride?: string;
  elapsedMs: number;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  initialUserMessage?: unknown;
  responsesMode?: boolean;
}): Promise<Array<ModelMessage>> {
  try {
    const input = {
      kind: "busy",
      label: args.action.label ?? args.parentDeck.label,
      source: { deckPath: args.parentDeck.path, actionName: args.action.name },
      trigger: {
        reason: "timeout" as const,
        elapsedMs: Math.floor(args.elapsedMs),
      },
      childInput: args.call.args,
    };
    const handlerOutput = await runDeck({
      path: args.handlerPath,
      input,
      modelProvider: args.modelProvider,
      isRoot: false,
      guardrails: args.guardrails,
      depth: args.depth + 1,
      parentActionCallId: args.call.id,
      runId: args.runId,
      defaultModel: args.defaultModel,
      modelOverride: args.modelOverride,
      trace: args.trace,
      stream: args.stream,
      onStreamText: args.onStreamText,
      responsesMode: args.responsesMode,
      initialUserMessage: args.initialUserMessage,
      inputProvided: true,
    });
    const elapsedMs = Math.floor(args.elapsedMs);
    let message: string | undefined;
    if (typeof handlerOutput === "string") {
      message = handlerOutput;
    } else if (handlerOutput && typeof handlerOutput === "object") {
      if (
        typeof (handlerOutput as { message?: unknown }).message === "string"
      ) {
        message = (handlerOutput as { message?: string }).message;
      } else {
        message = JSON.stringify(handlerOutput);
      }
    }
    if (!message) return [];
    if (args.onStreamText) {
      args.onStreamText(`${message}\n`);
    } else {
      logger.log(message);
    }
    return [{
      role: "assistant",
      content: `${message} (elapsed ${elapsedMs}ms)`,
    }];
  } catch {
    return [];
  }
}

function createIdleController(args: {
  cfg?: import("./types.ts").IdleHandlerConfig;
  deck: LoadedDeck;
  guardrails: Guardrails;
  depth: number;
  runId: string;
  parentActionCallId?: string;
  modelProvider: ModelProvider;
  defaultModel?: string;
  modelOverride?: string;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  pushMessages: (msgs: Array<ModelMessage>) => void;
  responsesMode?: boolean;
}): IdleController {
  if (!args.cfg?.path) {
    return {
      touch: () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {},
    };
  }

  const delayMs = args.cfg.delayMs ?? DEFAULT_STATUS_DELAY_MS;
  const repeatMs = args.cfg.repeatMs;
  let timer: number | undefined;
  let paused = false;
  let stopped = false;
  let lastTouched = performance.now();

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = () => {
    if (stopped || paused) return;
    clear();
    const now = performance.now();
    const remaining = Math.max(0, delayMs - (now - lastTouched));
    timer = setTimeout(async () => {
      if (stopped || paused) return;
      const elapsed = performance.now() - lastTouched;
      try {
        const envelope = await runIdleHandler({
          deck: args.deck,
          handlerPath: args.cfg!.path,
          runId: args.runId,
          parentActionCallId: args.parentActionCallId,
          modelProvider: args.modelProvider,
          guardrails: args.guardrails,
          depth: args.depth,
          defaultModel: args.defaultModel,
          modelOverride: args.modelOverride,
          elapsedMs: elapsed,
          trace: args.trace,
          stream: args.stream,
          onStreamText: args.onStreamText,
          responsesMode: args.responsesMode,
        });
        if (envelope.length) args.pushMessages(envelope.map(sanitizeMessage));
      } catch {
        // ignore idle handler errors
      }
      if (repeatMs && repeatMs > 0) {
        lastTouched = performance.now();
        schedule();
      }
    }, remaining) as unknown as number;
  };

  const touch = () => {
    if (stopped) return;
    lastTouched = performance.now();
    schedule();
  };
  const pause = () => {
    paused = true;
    clear();
  };
  const resume = () => {
    if (stopped) return;
    if (!paused) return;
    paused = false;
    schedule();
  };
  const stop = () => {
    stopped = true;
    clear();
  };

  return { touch, pause, resume, stop };
}

async function runIdleHandler(args: {
  deck: LoadedDeck;
  handlerPath: string;
  runId: string;
  parentActionCallId?: string;
  modelProvider: ModelProvider;
  guardrails: Guardrails;
  depth: number;
  defaultModel?: string;
  modelOverride?: string;
  elapsedMs: number;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  responsesMode?: boolean;
}): Promise<Array<ModelMessage>> {
  try {
    const input = {
      kind: "idle",
      label: args.deck.label,
      source: { deckPath: args.deck.path },
      trigger: {
        reason: "idle_timeout" as const,
        elapsedMs: Math.floor(args.elapsedMs),
      },
    };
    const handlerOutput = await runDeck({
      path: args.handlerPath,
      input,
      modelProvider: args.modelProvider,
      isRoot: false,
      guardrails: args.guardrails,
      depth: args.depth + 1,
      parentActionCallId: args.parentActionCallId,
      runId: args.runId,
      defaultModel: args.defaultModel,
      modelOverride: args.modelOverride,
      trace: args.trace,
      stream: args.stream,
      onStreamText: args.onStreamText,
      responsesMode: args.responsesMode,
      initialUserMessage: undefined,
      inputProvided: true,
    });
    const elapsedMs = Math.floor(args.elapsedMs);
    let message: string | undefined;
    if (typeof handlerOutput === "string") {
      message = handlerOutput;
    } else if (handlerOutput && typeof handlerOutput === "object") {
      if (
        typeof (handlerOutput as { message?: unknown }).message === "string"
      ) {
        message = (handlerOutput as { message?: string }).message;
      } else {
        message = JSON.stringify(handlerOutput);
      }
    }
    if (!message) return [];
    if (args.onStreamText) {
      args.onStreamText(`${message}\n`);
    } else {
      logger.log(message);
    }
    return [{
      role: "assistant",
      content: `${message} (idle for ${elapsedMs}ms)`,
    }];
  } catch {
    return [];
  }
}

async function maybeHandleError(args: {
  err: unknown;
  call: { id: string; name: string; args: Record<string, unknown> };
  ctx: {
    parentDeck: LoadedDeck;
    guardrails: Guardrails;
    depth: number;
    runId: string;
    parentActionCallId?: string;
    modelProvider: ModelProvider;
    defaultModel?: string;
    modelOverride?: string;
    trace?: (event: import("./types.ts").TraceEvent) => void;
    stream?: boolean;
    onStreamText?: (chunk: string) => void;
    responsesMode?: boolean;
  };
  action: { name: string; path: string; label?: string; description?: string };
}): Promise<ToolCallResult | undefined> {
  const handlerPath = args.ctx.parentDeck.handlers?.onError?.path;
  if (!handlerPath) return undefined;

  const message = args.err instanceof Error
    ? args.err.message
    : String(args.err);
  const envelopeInput = {
    kind: "error",
    label: args.action.label ?? args.ctx.parentDeck.label,
    source: {
      deckPath: args.ctx.parentDeck.path,
      actionName: args.action.name,
    },
    error: { message },
    childInput: args.call.args,
  };

  try {
    const handlerOutput = await runDeck({
      path: handlerPath,
      input: envelopeInput,
      modelProvider: args.ctx.modelProvider,
      isRoot: false,
      guardrails: args.ctx.guardrails,
      depth: args.ctx.depth + 1,
      parentActionCallId: args.call.id,
      runId: args.ctx.runId,
      defaultModel: args.ctx.defaultModel,
      modelOverride: args.ctx.modelOverride,
      trace: args.ctx.trace,
      stream: args.ctx.stream,
      onStreamText: args.ctx.onStreamText,
      responsesMode: args.ctx.responsesMode,
      initialUserMessage: undefined,
      inputProvided: true,
    });

    const parsed = typeof handlerOutput === "object" && handlerOutput !== null
      ? handlerOutput as Record<string, unknown>
      : undefined;
    const status = typeof parsed?.status === "number" ? parsed.status : 500;
    const code = typeof parsed?.code === "string" ? parsed.code : undefined;
    const messageOverride = typeof parsed?.message === "string"
      ? parsed.message
      : undefined;
    const meta = (parsed?.meta && typeof parsed.meta === "object")
      ? parsed.meta as Record<string, unknown>
      : undefined;
    const payload = parsed?.payload ?? handlerOutput;

    const content = JSON.stringify({
      runId: args.ctx.runId,
      actionCallId: args.call.id,
      parentActionCallId: args.ctx.parentActionCallId,
      source: {
        deckPath: args.ctx.parentDeck.path,
        actionName: args.action.name,
      },
      status,
      payload,
      message: messageOverride ?? message,
      code,
      meta,
    });

    const callId = randomId("event");
    const extraMessages: Array<ModelMessage> = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: {
            name: GAMBIT_TOOL_COMPLETE,
            arguments: content,
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: callId,
        name: GAMBIT_TOOL_COMPLETE,
        content,
      },
    ];

    return { toolContent: content, extraMessages };
  } catch {
    // Fallback when the handler itself fails: still return a structured error envelope
    // so the assistant can continue gracefully.
    const status = 500;
    const messageOverride = `Handled error: ${message}`;
    const code = "HANDLER_FALLBACK";
    const content = JSON.stringify({
      runId: args.ctx.runId,
      actionCallId: args.call.id,
      parentActionCallId: args.ctx.parentActionCallId,
      source: {
        deckPath: args.ctx.parentDeck.path,
        actionName: args.action.name,
      },
      status,
      payload: envelopeInput,
      message: messageOverride,
      code,
      meta: { handlerFailed: true },
    });

    const callId = randomId("event");
    const extraMessages: Array<ModelMessage> = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: {
            name: GAMBIT_TOOL_COMPLETE,
            arguments: content,
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: callId,
        name: GAMBIT_TOOL_COMPLETE,
        content,
      },
    ];

    return { toolContent: content, extraMessages };
  }
}

function buildSystemPrompt(deck: LoadedDeck): string {
  const parts: Array<string> = [];
  const prompt = deck.body ?? deck.prompt;
  if (prompt) parts.push(prompt.trim());
  if (!deck.inlineEmbeds) {
    for (const card of deck.cards) {
      if (card.body) parts.push(card.body.trim());
    }
  }
  return parts.join("\n\n").trim();
}

function formatInputForUser(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function sanitizeMessage(msg: ModelMessage): ModelMessage {
  const toolCalls = msg.tool_calls && msg.tool_calls.length > 0
    ? msg.tool_calls
    : undefined;
  return { ...msg, tool_calls: toolCalls };
}

async function buildToolDefs(deck: LoadedDeck): Promise<Array<ToolDefinition>> {
  const defs: Array<ToolDefinition> = [];
  if (deck.allowEnd) {
    defs.push({
      type: "function",
      function: {
        name: GAMBIT_TOOL_END,
        description: "End the current run once all goals are complete.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "number" },
            payload: {},
            message: { type: "string" },
            code: { type: "string" },
            meta: { type: "object" },
          },
          additionalProperties: true,
        },
      },
    });
  }
  if (deck.respond) {
    defs.push({
      type: "function",
      function: {
        name: GAMBIT_TOOL_RESPOND,
        description: "Finish the current deck with a structured response.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "number" },
            payload: {},
            message: { type: "string" },
            code: { type: "string" },
            meta: { type: "object" },
          },
          additionalProperties: true,
        },
      },
    });
  }
  for (const action of deck.actionDecks) {
    const child = await loadDeck(action.path, deck.path);
    ensureSchemaPresence(child, false);
    const schema = resolveContextSchema(child)!;
    const params = toJsonSchema(schema as never);
    defs.push({
      type: "function",
      function: {
        name: action.name,
        description: action.description,
        parameters: params,
      },
    });
  }
  return defs;
}
