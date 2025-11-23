import * as path from "@std/path";
import {
  DEFAULT_GUARDRAILS,
  DEFAULT_SUSPENSE_DELAY_MS,
  TOOL_ERROR_EVENT,
  TOOL_REFERENCE_CONTEXT,
  TOOL_SUSPENSE_EVENT,
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

function randomId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
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
};

export async function runDeck(opts: RunOptions): Promise<unknown> {
  const guardrails: Guardrails = {
    ...DEFAULT_GUARDRAILS,
    ...opts.guardrails,
  };
  const depth = opts.depth ?? 0;
  if (depth >= guardrails.maxDepth) {
    throw new Error(`Max depth ${guardrails.maxDepth} exceeded`);
  }
  const runId = opts.runId ?? randomId("run");

  const deck = await loadDeck(opts.path);
  const deckGuardrails = deck.guardrails ?? {};
  const effectiveGuardrails: Guardrails = {
    ...guardrails,
    ...deckGuardrails,
  };
  const isRoot = Boolean(opts.isRoot);

  ensureSchemaPresence(deck, isRoot);

  const validatedInput = validateInput(deck, opts.input, isRoot);
  if (deck.modelParams?.model) {
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
  });
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
    activity: deck.activity,
    spawnAndWait: async (opts) =>
      await runDeck({
        path: opts.path,
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
      }),
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
      activity: deck.activity,
      description: deck.actions?.map((a) => a.description).join(" ") || "",
    },
  };

  const refToolCallId = randomId("call");
  const messages: ModelMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: refToolCallId,
        type: "function",
        function: {
          name: TOOL_REFERENCE_CONTEXT,
          arguments: JSON.stringify(refCtx),
        },
      }],
    },
    {
      role: "tool",
      name: TOOL_REFERENCE_CONTEXT,
      tool_call_id: refToolCallId,
      content: JSON.stringify(refCtx),
    },
    {
      role: "user",
      content: formatInputForUser(input),
    },
  ];

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

    const result = await modelProvider.chat({ model, messages, tools });
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
      continue;
    }

    if (message.content !== null && message.content !== undefined) {
      const validated = validateOutput(deck, message.content, depth === 0);
      ctx.trace?.({ type: "deck.end", runId, deckPath: deck.path, actionCallId });
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
  },
): Promise<ToolCallResult> {
  const action = ctx.parentDeck.actions.find((a) => a.name === call.name);
  if (!action) {
    return {
      toolContent: JSON.stringify({
        ok: false,
        error: "unknown_action",
        action: call.name,
      }),
    };
  }

  const extraMessages: ModelMessage[] = [];
  const started = performance.now();

  const suspenseDelay = ctx.parentDeck.suspenseHandler?.delayMs ??
    ctx.parentDeck.suspenseDelayMs ??
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

  if (ctx.parentDeck.suspenseHandler?.path) {
    suspenseTimer = setTimeout(async () => {
      suspenseFired = true;
      const envelope = await runSuspenseHandler({
        parentDeck: ctx.parentDeck,
        action,
        call,
        runId: ctx.runId,
        parentActionCallId: ctx.parentActionCallId,
        handlerPath: ctx.parentDeck.suspenseHandler!.path,
        modelProvider: ctx.modelProvider,
        guardrails: ctx.guardrails,
        depth: ctx.depth,
        defaultModel: ctx.defaultModel,
        modelOverride: ctx.modelOverride,
        elapsedMs: performance.now() - started,
        trace: ctx.trace,
      });
      extraMessages.push(...envelope);
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

  const toolContent = typeof childResult.result === "string"
    ? childResult.result
    : JSON.stringify(childResult.result);

  if (suspenseFired && extraMessages.length === 0) {
    // Suspense handler failed silently; no extra messages.
  }

  return { toolContent, extraMessages };
}

async function runSuspenseHandler(args: {
  parentDeck: LoadedDeck;
  action: { name: string; path: string; activity?: string; description?: string };
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
}): Promise<ModelMessage[]> {
  try {
    const input = {
      kind: "suspense",
      activity: args.action.activity ?? args.parentDeck.activity,
      source: { deckPath: args.parentDeck.path, actionName: args.action.name },
      trigger: { reason: "timeout" as const, elapsedMs: Math.floor(args.elapsedMs) },
      childInput: args.call.args,
    };
    const envelope = await runDeck({
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
    });
    const content = typeof envelope === "string" ? envelope : JSON.stringify(envelope);
    const callId = randomId("event");
    return [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: {
            name: TOOL_SUSPENSE_EVENT,
            arguments: JSON.stringify({
              runId: args.runId,
              actionCallId: args.call.id,
              parentActionCallId: args.parentActionCallId,
            }),
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: callId,
        name: TOOL_SUSPENSE_EVENT,
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
  };
  action: { name: string; path: string; activity?: string; description?: string };
}): Promise<ToolCallResult | undefined> {
  const handlerPath = args.ctx.parentDeck.errorHandler?.path;
  if (!handlerPath) return undefined;

  const message = args.err instanceof Error ? args.err.message : String(args.err);
  const envelopeInput = {
    kind: "error",
    activity: args.action.activity ?? args.ctx.parentDeck.activity,
    source: { deckPath: args.ctx.parentDeck.path, actionName: args.action.name },
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
    });

    const content = typeof handlerOutput === "string"
      ? handlerOutput
      : JSON.stringify(handlerOutput);
    const callId = randomId("event");

    const extraMessages: ModelMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: {
            name: TOOL_ERROR_EVENT,
            arguments: JSON.stringify({
              runId: args.ctx.runId,
              actionCallId: args.call.id,
              parentActionCallId: args.ctx.parentActionCallId,
            }),
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: callId,
        name: TOOL_ERROR_EVENT,
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
  if (deck.prompt) parts.push(deck.prompt.trim());
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
