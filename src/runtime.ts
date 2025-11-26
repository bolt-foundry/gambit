import * as path from "@std/path";
import {
  DEFAULT_GUARDRAILS,
  DEFAULT_SUSPENSE_DELAY_MS,
  TOOL_COMPLETE,
  TOOL_INIT,
  TOOL_PING,
} from "./constants.ts";
import { loadDeck } from "./loader.ts";
import { assertZodSchema, toJsonSchema, validateWithSchema } from "./schema.ts";
import type {
  ExecutionContext,
  Guardrails,
  LoadedDeck,
  ModelMessage,
  ModelProvider,
  ReferenceContext,
  ToolCallResult,
  ToolDefinition,
} from "./types.ts";
import type { SavedState } from "./state.ts";

function randomId(prefix: string) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  // Keep IDs short enough for OpenAI/OpenRouter tool_call id limits (~40 chars).
  return `${prefix}-${suffix}`;
}

type RunOptions = {
  path: string;
  input: unknown;
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
  userFirst?: boolean;
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

  const validatedInput = validateInput(deck, opts.input, isRoot);
  const shouldEmitRun = opts.depth === undefined || opts.depth === 0;
  if (shouldEmitRun) {
    opts.trace?.({ type: "run.start", runId });
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
        defaultModel: opts.defaultModel,
        modelOverride: opts.modelOverride,
        trace: opts.trace,
        stream: opts.stream,
        state: opts.state,
        onStateUpdate: opts.onStateUpdate,
        onStreamText: opts.onStreamText,
        userFirst: opts.userFirst,
      });
    }

    if (!deck.executor) {
      throw new Error(
        `Deck ${deck.path} has no model and no executor (run or execute export)`,
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
      userFirst: opts.userFirst,
    });
  } finally {
    if (shouldEmitRun) {
      opts.trace?.({ type: "run.end", runId });
    }
  }
}

function ensureSchemaPresence(deck: LoadedDeck, isRoot: boolean) {
  if (!isRoot) {
    if (!deck.inputSchema || !deck.outputSchema) {
      throw new Error(
        `Deck ${deck.path} must declare inputSchema and outputSchema (non-root)`,
      );
    }
    assertZodSchema(deck.inputSchema, "inputSchema");
    assertZodSchema(deck.outputSchema, "outputSchema");
  }
}

function validateInput(deck: LoadedDeck, input: unknown, isRoot: boolean) {
  if (deck.inputSchema) {
    return validateWithSchema(deck.inputSchema as never, input);
  }
  if (isRoot) {
    if (input === undefined) return "";
    if (typeof input === "string") return input;
    return input;
  }
  throw new Error(`Deck ${deck.path} requires inputSchema (non-root)`);
}

function validateOutput(
  deck: LoadedDeck,
  output: unknown,
  isRoot: boolean,
): unknown {
  if (deck.outputSchema) {
    return validateWithSchema(deck.outputSchema as never, output);
  }
  if (isRoot) {
    if (typeof output === "string") return output;
    return JSON.stringify(output);
  }
  throw new Error(`Deck ${deck.path} requires outputSchema (non-root)`);
}

type RuntimeCtxBase = {
  deck: LoadedDeck;
  guardrails: Guardrails;
  depth: number;
  runId: string;
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
  userFirst?: boolean;
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
        userFirst: ctx.userFirst,
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

async function runLlmDeck(ctx: RuntimeCtxBase): Promise<unknown> {
  const { deck, guardrails, depth, modelProvider, input, runId } = ctx;
  const actionCallId = randomId("action");
  const start = performance.now();

  const systemPrompt = buildSystemPrompt(deck);
  const refCtx: ReferenceContext = {
    runId,
    actionCallId,
    parentActionCallId: ctx.parentActionCallId,
    input,
    action: {
      name: path.basename(deck.path),
      path: deck.path,
      label: deck.label,
      description: deck.actions?.map((a) => a.description).join(" ") || "",
    },
    guardrails: ctx.guardrails,
    model: ctx.modelOverride ??
      deck.modelParams?.model ??
      ctx.defaultModel,
  };

  const refToolCallId = randomId("call");
  const messages: ModelMessage[] = ctx.state?.messages
    ? ctx.state.messages.map(sanitizeMessage)
    : [];
  const resumed = messages.length > 0;
  if (!resumed) {
    messages.push(
      sanitizeMessage({ role: "system", content: systemPrompt }),
      sanitizeMessage({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: refToolCallId,
          type: "function",
          function: {
            name: TOOL_INIT,
            arguments: JSON.stringify(refCtx),
          },
        }],
      }),
      sanitizeMessage({
        role: "tool",
        name: TOOL_INIT,
        tool_call_id: refToolCallId,
        content: JSON.stringify(refCtx),
      }),
    );
  }

  if (ctx.userFirst) {
    messages.push(
      sanitizeMessage({
        role: "user",
        content: formatInputForUser(input),
      }),
    );
  }

  const tools = await buildToolDefs(deck);
  ctx.trace?.({ type: "deck.start", runId, deckPath: deck.path, actionCallId });
  let passes = 0;
  while (passes < guardrails.maxPasses) {
    passes++;
    if (performance.now() - start > guardrails.timeoutMs) {
      throw new Error("Timeout exceeded");
    }
    const model = ctx.modelOverride ??
      deck.modelParams?.model ??
      ctx.defaultModel ??
      (() => {
        throw new Error(
          `No model configured for deck ${deck.path} and no --model provided`,
        );
      })();

    const result = await modelProvider.chat({
      model,
      messages,
      tools,
      stream: ctx.stream,
      state: ctx.state,
      onStreamText: ctx.onStreamText,
    });
    const message = result.message;
    if (result.toolCalls && result.toolCalls.length > 0) {
      for (const call of result.toolCalls) {
        ctx.trace?.({
          type: "action.start",
          runId,
          actionCallId: call.id,
          name: call.name,
          path: call.name,
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
          onStreamText: ctx.onStreamText,
          runStartedAt: start,
          userFirst: ctx.userFirst,
        });
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          }],
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: toolResult.toolContent,
        });
        if (toolResult.extraMessages?.length) {
          messages.push(...toolResult.extraMessages);
        }
        ctx.trace?.({
          type: "action.end",
          runId,
          actionCallId: call.id,
          name: call.name,
          path: call.name,
        });
      }
      if (ctx.onStateUpdate) {
        const state = result.updatedState ??
          { runId, messages: messages.map(sanitizeMessage) };
        ctx.onStateUpdate(state);
      }
      continue;
    }

    if (message.content !== null && message.content !== undefined) {
      messages.push(sanitizeMessage(message));
      if (ctx.onStateUpdate) {
        const state = result.updatedState ??
          { runId, messages: messages.map(sanitizeMessage) };
        ctx.onStateUpdate(state);
      }
      const validated = validateOutput(deck, message.content, depth === 0);
      ctx.trace?.({
        type: "deck.end",
        runId,
        deckPath: deck.path,
        actionCallId,
      });
      return validated;
    }

    if (passes >= guardrails.maxPasses) {
      throw new Error("Max passes exceeded without completing");
    }
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
    userFirst?: boolean;
  },
): Promise<ToolCallResult> {
  const action = ctx.parentDeck.actions.find((a) => a.name === call.name);
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
  const extraMessages: ModelMessage[] = [];
  const started = performance.now();

  const suspenseDelay = ctx.parentDeck.handlers?.onPing?.delayMs ??
    DEFAULT_SUSPENSE_DELAY_MS;

  let suspenseTimer: number | undefined;
  let suspenseFired = false;
  let _suspenseElapsed = 0;

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
        userFirst: ctx.userFirst,
      });
      return { ok: true, result };
    } catch (err) {
      return { ok: false as const, error: err };
    } finally {
      if (suspenseTimer !== undefined) {
        clearTimeout(suspenseTimer);
      }
      _suspenseElapsed = performance.now() - started;
    }
  })();

  if (ctx.parentDeck.handlers?.onPing?.path) {
    suspenseTimer = setTimeout(async () => {
      suspenseFired = true;
      const elapsed = performance.now() - started;
      ctx.trace?.({
        type: "event",
        runId: ctx.runId,
        actionCallId: call.id,
        name: "suspense.fire",
        payload: {
          action: action.name,
          handlerPath: ctx.parentDeck.handlers!.onPing!.path,
          elapsedMs: Math.floor(elapsed),
        },
      });
      let envelope: ModelMessage[] = [];
      try {
        envelope = await runPingHandler({
          parentDeck: ctx.parentDeck,
          action,
          call,
          runId: ctx.runId,
          parentActionCallId: ctx.parentActionCallId,
          handlerPath: ctx.parentDeck.handlers!.onPing!.path,
          modelProvider: ctx.modelProvider,
          guardrails: ctx.guardrails,
          depth: ctx.depth,
          defaultModel: ctx.defaultModel,
          modelOverride: ctx.modelOverride,
          elapsedMs: performance.now() - started,
          trace: ctx.trace,
          stream: ctx.stream,
          onStreamText: ctx.onStreamText,
          userFirst: ctx.userFirst,
        });
      } catch (err) {
        ctx.trace?.({
          type: "event",
          runId: ctx.runId,
          actionCallId: call.id,
          name: "suspense.error",
          payload: {
            action: action.name,
            handlerPath: ctx.parentDeck.handlers!.onPing!.path,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        envelope = [];
      }
      extraMessages.push(...envelope.map(sanitizeMessage));
      if (envelope.length) {
        const toolMsg = envelope.find((m) => m.role === "tool");
        ctx.trace?.({
          type: "event",
          runId: ctx.runId,
          actionCallId: call.id,
          name: "suspense.result",
          payload: {
            action: action.name,
            handlerPath: ctx.parentDeck.handlers!.onPing!.path,
            elapsedMs: Math.floor(performance.now() - started),
            messages: envelope.length,
          },
        });
        if (toolMsg?.content) {
          if (ctx.onStreamText) {
            ctx.onStreamText(`${toolMsg.content}\n`);
          } else {
            console.log(toolMsg.content);
          }
        }
      }
    }, suspenseDelay) as unknown as number;
  }

  const childResult = await childPromise;

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
      const content = handled.toolContent;
      return { toolContent: content, extraMessages };
    }

    throw childResult.error;
  }

  const toolContent = baseComplete({
    status: 200,
    payload: childResult.result,
  });

  if (!suspenseFired && ctx.parentDeck.handlers?.onPing?.path) {
    const elapsedFromStart = performance.now() - ctx.runStartedAt;
    if (elapsedFromStart >= suspenseDelay) {
      suspenseFired = true;
      let envelope: ModelMessage[] = [];
      try {
        envelope = await runPingHandler({
          parentDeck: ctx.parentDeck,
          action,
          call,
          runId: ctx.runId,
          parentActionCallId: ctx.parentActionCallId,
          handlerPath: ctx.parentDeck.handlers!.onPing!.path,
          modelProvider: ctx.modelProvider,
          guardrails: ctx.guardrails,
          depth: ctx.depth,
          defaultModel: ctx.defaultModel,
          modelOverride: ctx.modelOverride,
          elapsedMs: elapsedFromStart,
          trace: ctx.trace,
          stream: ctx.stream,
          onStreamText: ctx.onStreamText,
          userFirst: ctx.userFirst,
        });
      } catch (err) {
        ctx.trace?.({
          type: "event",
          runId: ctx.runId,
          actionCallId: call.id,
          name: "suspense.error",
          payload: {
            action: action.name,
            handlerPath: ctx.parentDeck.handlers!.onPing!.path,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        envelope = [];
      }
      extraMessages.push(...envelope.map(sanitizeMessage));
      if (envelope.length) {
        const toolMsg = envelope.find((m) => m.role === "tool");
        if (toolMsg?.content) {
          ctx.trace?.({
            type: "event",
            runId: ctx.runId,
            actionCallId: call.id,
            name: "suspense.result",
            payload: {
              action: action.name,
              handlerPath: ctx.parentDeck.handlers!.onPing!.path,
              elapsedMs: Math.floor(elapsedFromStart),
              messages: envelope.length,
              kind: "late",
            },
          });
          if (ctx.onStreamText) {
            ctx.onStreamText(`${toolMsg.content}\n`);
          } else {
            console.log(toolMsg.content);
          }
        }
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
          name: TOOL_COMPLETE,
          arguments: toolContent,
        },
      }],
    },
    {
      role: "tool",
      tool_call_id: completeEventId,
      name: TOOL_COMPLETE,
      content: toolContent,
    },
  );

  return { toolContent, extraMessages };
}

async function runPingHandler(args: {
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
  userFirst?: boolean;
}): Promise<ModelMessage[]> {
  try {
    const input = {
      kind: "suspense",
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
      userFirst: args.userFirst,
    });
    const elapsedMs = Math.floor(args.elapsedMs);
    let message: string | undefined;
    let payload: unknown;
    let meta: Record<string, unknown> | undefined;
    if (typeof handlerOutput === "string") {
      message = handlerOutput;
    } else if (handlerOutput && typeof handlerOutput === "object") {
      if (
        typeof (handlerOutput as { message?: unknown }).message === "string"
      ) {
        message = (handlerOutput as { message?: string }).message;
      }
      payload = (handlerOutput as { payload?: unknown }).payload ??
        handlerOutput;
      if (
        typeof (handlerOutput as { meta?: unknown }).meta === "object" &&
        (handlerOutput as { meta?: unknown }).meta !== null
      ) {
        meta = (handlerOutput as { meta?: Record<string, unknown> }).meta;
      }
    }
    const status = message || payload || meta ? 103 : 102;
    const pingEnvelope = {
      runId: args.runId,
      actionCallId: args.call.id,
      parentActionCallId: args.parentActionCallId,
      source: { deckPath: args.parentDeck.path, actionName: args.action.name },
      elapsedMs,
      status,
      message,
      payload,
      meta,
    };
    const content = JSON.stringify(pingEnvelope);
    const callId = randomId("event");
    return [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: {
            name: TOOL_PING,
            arguments: content,
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: callId,
        name: TOOL_PING,
        content,
      },
    ];
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
    userFirst?: boolean;
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
      userFirst: args.ctx.userFirst,
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
    const extraMessages: ModelMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: {
            name: TOOL_COMPLETE,
            arguments: content,
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: callId,
        name: TOOL_COMPLETE,
        content,
      },
    ];

    return { toolContent: content, extraMessages };
  } catch {
    return undefined;
  }
}

function buildSystemPrompt(deck: LoadedDeck): string {
  const parts: string[] = [];
  const prompt = deck.body ?? deck.prompt;
  if (prompt) parts.push(prompt.trim());
  for (const card of deck.cards) {
    if (card.body) parts.push(card.body.trim());
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

async function buildToolDefs(deck: LoadedDeck): Promise<ToolDefinition[]> {
  const defs: ToolDefinition[] = [];
  for (const action of deck.actions) {
    const child = await loadDeck(action.path, deck.path);
    ensureSchemaPresence(child, false);
    const schema = child.inputSchema!;
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
