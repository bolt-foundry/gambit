import { RESERVED_TOOL_PREFIX } from "./constants.ts";
import { loadDeck } from "./loader.ts";
import { assertZodSchema, toJsonSchema } from "./schema.ts";
import type {
  LoadedDeck,
  ModelMessage,
  ModelParams,
  ToolDefinition,
} from "./types.ts";

export const logger = console;

export type RenderChatCompletionsRequest = {
  model?: string;
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

export type RenderDeckOptions = {
  deckPath: string;
  request: RenderChatCompletionsRequest;
  includeDeckSystem?: boolean;
  includeDeckTools?: boolean;
  warnOnSystemMismatch?: boolean;
};

export type RenderDeckResult = {
  request: {
    model: string;
    messages: Array<ModelMessage>;
    tools?: Array<ToolDefinition>;
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    max_tokens?: number;
    [key: string]: unknown;
  };
  gambit: {
    deckPath: string;
    systemPrompt: string;
    actionPathsByName: Record<string, string>;
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
  input: RenderChatCompletionsRequest["messages"],
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

function deckSystemPrompt(deck: Awaited<ReturnType<typeof loadDeck>>): string {
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
    `[gambit] renderDeck: request includes a system message that does not match the deck prompt (${args.deckPath})`,
  );
}

function toolName(tool: ToolDefinition): string {
  return tool.function?.name ?? "";
}

function resolveContextSchema(deck: LoadedDeck) {
  return deck.contextSchema ?? deck.inputSchema;
}

function resolveResponseSchema(deck: LoadedDeck) {
  return deck.responseSchema ?? deck.outputSchema;
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

async function buildDeckActionTools(deckPath: string): Promise<{
  tools: Array<ToolDefinition>;
  actionPathsByName: Record<string, string>;
}> {
  const deck = await loadDeck(deckPath);
  const tools: Array<ToolDefinition> = [];
  const actionPathsByName: Record<string, string> = {};

  for (const action of deck.actionDecks) {
    const child = await loadDeck(action.path, deck.path);
    const contextSchema = resolveContextSchema(child);
    const responseSchema = resolveResponseSchema(child);
    if (!contextSchema || !responseSchema) {
      throw new Error(
        `Deck ${child.path} must declare contextSchema and responseSchema (non-root)`,
      );
    }
    assertZodSchema(contextSchema, "contextSchema");
    assertZodSchema(responseSchema, "responseSchema");
    const params = toJsonSchema(contextSchema as never);
    tools.push({
      type: "function",
      function: {
        name: action.name,
        description: action.description,
        parameters: params,
      },
    });
    actionPathsByName[action.name] = action.path;
  }

  return { tools, actionPathsByName };
}

function mergeModelParams(
  req: RenderChatCompletionsRequest,
  deckParams: ModelParams | undefined,
): RenderChatCompletionsRequest {
  const out: RenderChatCompletionsRequest = { ...req };
  if (!deckParams) return out;
  if (out.model === undefined && deckParams.model) {
    out.model = Array.isArray(deckParams.model)
      ? deckParams.model.find((entry) =>
        typeof entry === "string" && entry.trim().length > 0
      )
      : deckParams.model;
  }
  if (out.temperature === undefined && deckParams.temperature !== undefined) {
    out.temperature = deckParams.temperature;
  }
  if (out.top_p === undefined && deckParams.top_p !== undefined) {
    out.top_p = deckParams.top_p;
  }
  if (
    out.frequency_penalty === undefined &&
    deckParams.frequency_penalty !== undefined
  ) {
    out.frequency_penalty = deckParams.frequency_penalty;
  }
  if (
    out.presence_penalty === undefined &&
    deckParams.presence_penalty !== undefined
  ) {
    out.presence_penalty = deckParams.presence_penalty;
  }
  if (out.max_tokens === undefined && deckParams.max_tokens !== undefined) {
    out.max_tokens = deckParams.max_tokens;
  }
  return out;
}

export async function renderDeck(
  opts: RenderDeckOptions,
): Promise<RenderDeckResult> {
  const includeDeckSystem = opts.includeDeckSystem ?? true;
  const includeDeckTools = opts.includeDeckTools ?? true;
  const warnOnSystemMismatch = opts.warnOnSystemMismatch ?? true;

  const deck = await loadDeck(opts.deckPath);
  const systemPrompt = deckSystemPrompt(deck);

  const mergedReq = mergeModelParams(opts.request, deck.modelParams);

  const providedMessages = normalizeMessages(mergedReq.messages);
  const messages: Array<ModelMessage> = [];

  if (includeDeckSystem) {
    if (warnOnSystemMismatch) {
      warnIfSystemMismatch({
        provided: providedMessages,
        systemPrompt,
        deckPath: deck.path,
      });
    }
    if (shouldPrependDeckSystem(providedMessages, systemPrompt)) {
      messages.push({ role: "system", content: systemPrompt });
    }
  }
  messages.push(...providedMessages);

  let tools: Array<ToolDefinition> | undefined = undefined;
  let actionPathsByName: Record<string, string> = {};

  if (includeDeckTools) {
    const built = await buildDeckActionTools(deck.path);
    actionPathsByName = built.actionPathsByName;
    assertNoToolNameCollisions({
      gambitTools: built.tools,
      externalTools: mergedReq.tools,
    });
    tools = mergedReq.tools?.length
      ? [...built.tools, ...mergedReq.tools]
      : built.tools;
  } else if (mergedReq.tools?.length) {
    for (const t of mergedReq.tools) {
      const name = toolName(t);
      if (name.startsWith(RESERVED_TOOL_PREFIX)) {
        throw new Error(
          `External tool name ${name} is reserved (prefix ${RESERVED_TOOL_PREFIX})`,
        );
      }
    }
    tools = mergedReq.tools;
  }

  const resolvedModel = Array.isArray(mergedReq.model)
    ? mergedReq.model.find((entry) =>
      typeof entry === "string" && entry.trim().length > 0
    )
    : mergedReq.model;
  const model = String(resolvedModel ?? "").trim();
  if (!model) {
    throw new Error(
      `renderDeck requires request.model (or deck.modelParams.model): ${deck.path}`,
    );
  }

  const { messages: _m, tools: _t, ...rest } = mergedReq;

  return {
    request: {
      ...rest,
      model,
      messages,
      tools: tools && tools.length ? tools : undefined,
    },
    gambit: {
      deckPath: deck.path,
      systemPrompt,
      actionPathsByName,
    },
  };
}
