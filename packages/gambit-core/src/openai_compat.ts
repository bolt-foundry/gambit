import { DEFAULT_GUARDRAILS, RESERVED_TOOL_PREFIX } from "./constants.ts";
import { loadDeck } from "./loader.ts";
import { assertZodSchema, toJsonSchema } from "./schema.ts";
import { runDeck } from "./runtime.ts";
import type {
  Guardrails,
  LoadedDeck,
  ModelMessage,
  ModelProvider,
  ToolDefinition,
} from "./types.ts";

export const logger = console;

function randomId(prefix: string) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}-${suffix}`;
}

export type ChatCompletionsRequest = {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content:
      | string
      | null
      | Array<string | { text?: string; type?: string }>;
    name?: string;
    tool_call_id?: string;
    tool_calls?: ModelMessage["tool_calls"];
  }>;
  tools?: Array<ToolDefinition>;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
  [key: string]: unknown;
};

export type ChatCompletionsResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ModelMessage;
    finish_reason: "stop" | "tool_calls" | "length";
    logprobs: null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /**
   * Non-OpenAI extension field containing the full transcript and metadata.
   * Most clients will ignore unknown fields.
   */
  gambit?: {
    deckPath: string;
    messages: Array<ModelMessage>;
    runId: string;
  };
};

function normalizeContent(
  content:
    | string
    | null
    | Array<string | { text?: string; type?: string }>,
): string | null {
  if (content === null) return null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);
  return content
    .map((c) => (typeof c === "string" ? c : (c.text ?? "")))
    .join("");
}

function normalizeMessages(
  input: ChatCompletionsRequest["messages"],
): Array<ModelMessage> {
  return input.map((m) => ({
    role: m.role,
    content: normalizeContent(m.content),
    name: m.name,
    tool_call_id: m.tool_call_id,
    tool_calls: m.tool_calls && m.tool_calls.length > 0
      ? m.tool_calls
      : undefined,
  }));
}

function providerParamsFromRequest(
  req: ChatCompletionsRequest,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  if (req.frequency_penalty !== undefined) {
    out.frequency_penalty = req.frequency_penalty;
  }
  if (req.presence_penalty !== undefined) {
    out.presence_penalty = req.presence_penalty;
  }
  if (req.max_tokens !== undefined) out.max_tokens = req.max_tokens;
  return Object.keys(out).length ? out : undefined;
}

function mergeToolDefs(
  gambitTools: Array<ToolDefinition>,
  externalTools: Array<ToolDefinition> | undefined,
) {
  if (!externalTools?.length) return gambitTools;
  return [...gambitTools, ...externalTools];
}

function toolName(tool: ToolDefinition): string {
  return tool.function?.name ?? "";
}

function assertNoToolNameCollisions(args: {
  gambitTools: Array<ToolDefinition>;
  externalTools?: Array<ToolDefinition>;
}) {
  if (!args.externalTools?.length) return;
  const gambit = new Set(args.gambitTools.map(toolName));
  for (const t of args.externalTools) {
    const name = toolName(t);
    if (!name) continue;
    if (name.startsWith(RESERVED_TOOL_PREFIX)) {
      throw new Error(
        `External tool name ${name} is reserved (prefix ${RESERVED_TOOL_PREFIX})`,
      );
    }
    if (gambit.has(name)) {
      throw new Error(
        `Tool name collision for ${name} between Gambit deck actions and external tools`,
      );
    }
  }
}

async function buildGambitActionTools(deck: LoadedDeck): Promise<{
  tools: Array<ToolDefinition>;
  toolNameSet: Set<string>;
  actionPathByName: Map<string, string>;
}> {
  const tools: Array<ToolDefinition> = [];
  const toolNameSet = new Set<string>();
  const actionPathByName = new Map<string, string>();

  for (const action of deck.actionDecks) {
    const child = await loadDeck(action.path, deck.path);
    if (!child.inputSchema || !child.outputSchema) {
      throw new Error(
        `Deck ${child.path} must declare inputSchema and outputSchema (non-root)`,
      );
    }
    assertZodSchema(child.inputSchema, "inputSchema");
    assertZodSchema(child.outputSchema, "outputSchema");

    const params = toJsonSchema(child.inputSchema as never);
    tools.push({
      type: "function",
      function: {
        name: action.name,
        description: action.description,
        parameters: params,
      },
    });
    toolNameSet.add(action.name);
    actionPathByName.set(action.name, action.path);
  }

  return { tools, toolNameSet, actionPathByName };
}

function deckSystemPrompt(deck: Awaited<ReturnType<typeof loadDeck>>): string {
  const parts: Array<string> = [];
  const prompt = deck.body ?? deck.prompt;
  if (prompt) parts.push(prompt.trim());
  for (const card of deck.cards) {
    if (card.body) parts.push(card.body.trim());
  }
  return parts.join("\n\n").trim();
}

function shouldPrependDeckSystem(
  messages: Array<ModelMessage>,
  systemPrompt: string,
): boolean {
  if (!systemPrompt) return false;
  if (!messages.length) return true;
  const hasExact = messages.some((m) =>
    m.role === "system" && m.content === systemPrompt
  );
  return !hasExact;
}

function warnIfSystemMismatch(args: {
  provided: Array<ModelMessage>;
  systemPrompt: string;
  deckPath: string;
}) {
  if (!args.systemPrompt) return;
  const existing = args.provided.find((m) => m.role === "system");
  if (!existing) return;
  if (existing.content === args.systemPrompt) return;
  logger.warn(
    `[gambit] chatCompletionsWithDeck: request includes a system message that does not match the deck prompt (${args.deckPath})`,
  );
}

function toolResultContent(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function normalizeError(err: unknown): { message: string } {
  return { message: err instanceof Error ? err.message : String(err) };
}

export async function chatCompletionsWithDeck(args: {
  deckPath: string;
  request: ChatCompletionsRequest;
  modelProvider: ModelProvider;
  /**
   * When true (default), Gambit will execute tool calls that match deck actions.
   * Any other tool calls are returned to the caller as normal OpenAI tool calls.
   */
  executeDeckTools?: boolean;
  guardrails?: Partial<Guardrails>;
  defaultModel?: string;
  onStreamText?: (chunk: string) => void;
}): Promise<ChatCompletionsResponse> {
  const executeDeckTools = args.executeDeckTools ?? true;
  const guardrails: Guardrails = { ...DEFAULT_GUARDRAILS, ...args.guardrails };
  const runId = randomId("run");

  const deck = await loadDeck(args.deckPath);
  const systemPrompt = deckSystemPrompt(deck);

  const providedMessages = normalizeMessages(args.request.messages);
  const messages: Array<ModelMessage> = [];
  warnIfSystemMismatch({
    provided: providedMessages,
    systemPrompt,
    deckPath: deck.path,
  });
  if (shouldPrependDeckSystem(providedMessages, systemPrompt)) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push(...providedMessages);

  const gambit = await buildGambitActionTools(deck);
  assertNoToolNameCollisions({
    gambitTools: gambit.tools,
    externalTools: args.request.tools,
  });

  const tools = mergeToolDefs(gambit.tools, args.request.tools);
  const start = performance.now();
  let passes = 0;

  while (passes < guardrails.maxPasses) {
    passes++;
    if (performance.now() - start > guardrails.timeoutMs) {
      throw new Error("Timeout exceeded");
    }

    const model = args.request.model ?? args.defaultModel ??
      (() => {
        throw new Error("No model provided");
      })();

    const result = await args.modelProvider.chat({
      model,
      messages,
      tools: tools.length ? tools : undefined,
      stream: Boolean(args.request.stream),
      onStreamText: args.onStreamText,
      params: providerParamsFromRequest(args.request),
    });

    messages.push(result.message);

    if (result.toolCalls && result.toolCalls.length > 0) {
      const gambitCalls = result.toolCalls.filter((c) =>
        gambit.toolNameSet.has(c.name)
      );
      const externalCalls = result.toolCalls.filter((c) =>
        !gambit.toolNameSet.has(c.name)
      );

      if (!executeDeckTools || externalCalls.length > 0) {
        return {
          id: randomId("chatcmpl"),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: result.message,
            finish_reason: "tool_calls",
            logprobs: null,
          }],
          usage: result.usage
            ? {
              prompt_tokens: result.usage.promptTokens,
              completion_tokens: result.usage.completionTokens,
              total_tokens: result.usage.totalTokens,
            }
            : undefined,
          gambit: { deckPath: deck.path, messages, runId },
        };
      }

      // Execute only deck-defined tool calls.
      for (const call of gambitCalls) {
        const actionPath = gambit.actionPathByName.get(call.name);
        if (!actionPath) continue;
        try {
          const childResult = await runDeck({
            path: actionPath,
            input: call.args,
            modelProvider: args.modelProvider,
            isRoot: false,
            guardrails,
            depth: 1,
            parentActionCallId: call.id,
            runId,
            defaultModel: model,
            modelOverride: undefined,
            trace: undefined,
            stream: Boolean(args.request.stream),
            onStreamText: args.onStreamText,
            inputProvided: true,
          });
          messages.push({
            role: "tool",
            name: call.name,
            tool_call_id: call.id,
            content: toolResultContent(childResult),
          });
        } catch (err) {
          messages.push({
            role: "tool",
            name: call.name,
            tool_call_id: call.id,
            content: JSON.stringify({ error: normalizeError(err) }),
          });
        }
      }

      continue;
    }

    if (result.finishReason === "tool_calls") {
      throw new Error("Model requested tool_calls but provided none");
    }

    return {
      id: randomId("chatcmpl"),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: result.message,
        finish_reason: result.finishReason,
        logprobs: null,
      }],
      usage: result.usage
        ? {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.totalTokens,
        }
        : undefined,
      gambit: { deckPath: deck.path, messages, runId },
    };
  }

  throw new Error("Max passes exceeded without completing");
}
