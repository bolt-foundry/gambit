import * as path from "@std/path";
import { DEFAULT_GUARDRAILS, TOOL_REFERENCE_CONTEXT } from "./constants.ts";
import { loadDeck } from "./loader.ts";
import { assertZodSchema, toJsonSchema, validateWithSchema } from "./schema.ts";
import type {
  ExecutionContext,
  Guardrails,
  LoadedDeck,
  ModelMessage,
  ModelProvider,
  ReferenceContext,
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
  const isRoot = Boolean(opts.isRoot);

  ensureSchemaPresence(deck, isRoot);

  const validatedInput = validateInput(deck, opts.input, isRoot);
  if (deck.modelParams?.model) {
    return await runLlmDeck({
      deck,
      guardrails,
      depth,
      runId,
      parentActionCallId: opts.parentActionCallId,
      modelProvider: opts.modelProvider,
      input: validatedInput,
      defaultModel: opts.defaultModel,
      modelOverride: opts.modelOverride,
    });
  }

  if (!deck.executor) {
    throw new Error(
      `Deck ${deck.path} has no model and no executor (run or execute export)`,
    );
  }

  return await runComputeDeck({
    deck,
    guardrails,
    depth,
    runId,
    parentActionCallId: opts.parentActionCallId,
    modelProvider: opts.modelProvider,
    input: validatedInput,
    defaultModel: opts.defaultModel,
    modelOverride: opts.modelOverride,
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
        const toolContent = await handleToolCall(call, {
          parentDeck: deck,
          modelProvider,
          guardrails,
          depth,
          runId,
          parentActionCallId: actionCallId,
          defaultModel: ctx.defaultModel,
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
          content: toolContent,
        });
      }
      continue;
    }

    if (message.content !== null && message.content !== undefined) {
      const validated = validateOutput(deck, message.content, depth === 0);
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
  },
): Promise<string> {
  const action = ctx.parentDeck.actions.find((a) => a.name === call.name);
  if (!action) {
    return JSON.stringify({
      ok: false,
      error: "unknown_action",
      action: call.name,
    });
  }

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
    });
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: "action_failed",
      message: err instanceof Error ? err.message : String(err),
    });
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
