import OpenAI from "@openai/openai";
import type {
  CreateResponseRequest,
  CreateResponseResponse,
  JSONValue,
  ModelMessage,
  ModelProvider,
  ResponseEvent,
  ResponseItem,
  ResponseMessageItem,
  ResponseTextContent,
  ResponseToolDefinition,
  ResponseUsage,
} from "@bolt-foundry/gambit-core";
import {
  GAMBIT_TOOL_CONTEXT,
  GAMBIT_TOOL_INIT,
} from "@bolt-foundry/gambit-core";

const logger = console;
export const OLLAMA_PREFIX = "ollama/";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

type OpenAIClient = {
  responses: {
    create: (params: unknown) => Promise<unknown>;
  };
};

type OllamaTagsResponse = {
  models?: Array<{ name?: string }>;
};

function buildOllamaApiBase(baseURL: string | undefined): URL {
  const url = new URL(baseURL ?? DEFAULT_OLLAMA_BASE_URL);
  url.pathname = url.pathname.replace(/\/v1\/?$/, "/");
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

export async function fetchOllamaTags(
  baseURL: string | undefined,
): Promise<Set<string>> {
  const apiBase = buildOllamaApiBase(baseURL);
  const tagsUrl = new URL("api/tags", apiBase);
  const tagsResponse = await fetch(tagsUrl);
  if (!tagsResponse.ok) {
    throw new Error(
      `Failed to list Ollama models (${tagsResponse.status} ${tagsResponse.statusText}).`,
    );
  }
  const tags = (await tagsResponse.json()) as OllamaTagsResponse;
  const models = tags.models ?? [];
  return new Set(
    models
      .map((entry) => entry.name?.trim())
      .filter((name): name is string => Boolean(name)),
  );
}

export async function ensureOllamaModel(
  model: string,
  baseURL: string | undefined,
): Promise<void> {
  const tags = await fetchOllamaTags(baseURL);
  if (tags.has(model)) {
    return;
  }

  logger.log(`Ollama model "${model}" not found; pulling from Ollama...`);
  const apiBase = buildOllamaApiBase(baseURL);
  const pullUrl = new URL("api/pull", apiBase);
  const pullResponse = await fetch(pullUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model }),
  });
  if (!pullResponse.ok || !pullResponse.body) {
    throw new Error(
      `Failed to pull Ollama model "${model}" (${pullResponse.status} ${pullResponse.statusText}).`,
    );
  }

  const decoder = new TextDecoder();
  const reader = pullResponse.body.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { status?: string; error?: string };
        if (event.error) {
          throw new Error(event.error);
        }
        if (event.status) {
          logger.log(`[ollama] ${event.status}`);
        }
      } catch (err) {
        throw new Error(
          `Failed to parse Ollama pull response: ${(err as Error).message}`,
        );
      }
    }
  }
}

function safeJson(input: string): Record<string, JSONValue> {
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, JSONValue>;
    }
  } catch {
    // fall through
  }
  return {};
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Symbol.asyncIterator in (value as Record<string, unknown>),
  );
}

function mapUsage(
  usage: OpenAI.Responses.ResponseUsage | null | undefined,
): ResponseUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

function mapStatus(
  status: OpenAI.Responses.ResponseStatus | null | undefined,
): CreateResponseResponse["status"] | undefined {
  if (!status) return undefined;
  if (status === "completed") return "completed";
  if (status === "in_progress" || status === "queued") return "in_progress";
  return "failed";
}

function mapError(
  error: OpenAI.Responses.ResponseError | null | undefined,
): { code?: string; message?: string } | undefined {
  if (!error) return undefined;
  return { code: error.code, message: error.message };
}

function mapTools(
  tools: Array<ResponseToolDefinition> | undefined,
): Array<OpenAI.Responses.FunctionTool> | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description ?? null,
    parameters: normalizeToolParameters(tool.function.parameters),
    strict: false,
  }));
}

function normalizeToolParameters(
  parameters: Record<string, JSONValue> | undefined,
): Record<string, JSONValue> {
  const normalized = structuredClone(parameters ?? {}) as Record<
    string,
    JSONValue
  >;
  if (normalized.type !== "object") {
    return normalized;
  }
  if (normalized.properties === undefined) {
    normalized.properties = {};
  }
  const props = normalized.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    const requiredKeys = Array.isArray(normalized.required)
      ? (normalized.required as Array<string>).filter((key) =>
        typeof key === "string" && key in props
      )
      : [];
    for (const [key, value] of Object.entries(props)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (!("type" in value)) continue;
      if (value.type === "object" && value.additionalProperties !== false) {
        props[key] = {
          ...(value as Record<string, JSONValue>),
          additionalProperties: false,
        };
      }
    }
    if (requiredKeys.length > 0) {
      normalized.required = requiredKeys;
    }
  }
  const additional = normalized.additionalProperties;
  if (additional !== false) {
    normalized.additionalProperties = false;
  }
  return normalized;
}

function appendSyntheticTools(
  tools: Array<OpenAI.Responses.FunctionTool>,
  input: Array<ResponseItem>,
) {
  const needed = new Set<string>();
  for (const item of input) {
    if (item.type !== "function_call") continue;
    if (item.name === GAMBIT_TOOL_CONTEXT || item.name === GAMBIT_TOOL_INIT) {
      needed.add(item.name);
    }
  }
  for (const name of needed) {
    if (tools.some((tool) => tool.name === name)) continue;
    tools.push({
      type: "function",
      name,
      description: "Synthetic Gambit context payload.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        required: [],
      },
      strict: false,
    });
  }
}

function mapToolChoice(
  toolChoice: CreateResponseRequest["tool_choice"],
):
  | OpenAI.Responses.ToolChoiceOptions
  | OpenAI.Responses.ToolChoiceFunction
  | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === "auto" || toolChoice === "required") return toolChoice;
  return { type: "function", name: toolChoice.function.name };
}

function mapOpenAIOutputItem(
  item: OpenAI.Responses.ResponseOutputItem,
): ResponseItem | null {
  const itemType = (item as { type?: string }).type;
  if (itemType === "message") {
    const message = item as OpenAI.Responses.ResponseOutputMessage;
    const content: Array<ResponseTextContent> = [];
    for (const part of message.content ?? []) {
      if (part.type === "output_text") {
        content.push({ type: "output_text", text: part.text });
      }
    }
    if (content.length === 0) return null;
    return {
      type: "message",
      role: "assistant",
      content,
      id: message.id,
    } satisfies ResponseMessageItem;
  }
  if (itemType === "function_call") {
    const call = item as OpenAI.Responses.ResponseFunctionToolCall;
    return {
      type: "function_call",
      call_id: call.call_id,
      name: call.name,
      arguments: call.arguments,
      id: call.id,
    };
  }
  return null;
}

function normalizeOpenAIResponse(
  response: OpenAI.Responses.Response,
): CreateResponseResponse {
  const outputItems = (response.output ?? [])
    .map(mapOpenAIOutputItem)
    .filter((item): item is ResponseItem => Boolean(item));
  return {
    id: response.id,
    object: "response",
    model: response.model,
    created: response.created_at,
    status: mapStatus(response.status ?? undefined),
    output: outputItems,
    usage: mapUsage(response.usage),
    error: mapError(response.error),
  };
}

function toOpenAIInputItems(
  items: Array<ResponseItem>,
): Array<Record<string, unknown>> {
  const mapped: Array<Record<string, unknown>> = [];
  for (const item of items) {
    if (item.type === "message") {
      const isAssistant = item.role === "assistant";
      const content = item.content
        .map((part) => {
          if (part.type === "output_text") {
            return {
              type: "output_text",
              text: part.text,
            };
          }
          if (part.type === "input_text") {
            return {
              type: isAssistant ? "output_text" : "input_text",
              text: part.text,
            };
          }
          return null;
        })
        .filter((
          part,
        ): part is { type: "input_text" | "output_text"; text: string } =>
          Boolean(part)
        );
      if (content.length === 0) continue;
      mapped.push({
        type: "message",
        role: item.role,
        content,
        id: item.id,
      });
      continue;
    }
    if (item.type === "function_call") {
      mapped.push({
        type: "function_call",
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
        id: item.id,
      });
      continue;
    }
    if (item.type === "function_call_output") {
      mapped.push({
        type: "function_call_output",
        call_id: item.call_id,
        output: item.output,
        id: item.id,
      });
    }
  }
  return mapped;
}

function chatMessagesToResponseItems(
  messages: Array<ModelMessage>,
): Array<ResponseItem> {
  const items: Array<ResponseItem> = [];
  for (const message of messages) {
    if (message.role === "tool") {
      if (
        message.tool_call_id &&
        typeof message.content === "string"
      ) {
        items.push({
          type: "function_call_output",
          call_id: message.tool_call_id,
          output: message.content,
        });
      }
      continue;
    }
    if (
      message.role === "system" || message.role === "user" ||
      message.role === "assistant"
    ) {
      const content: Array<ResponseTextContent> = [];
      if (typeof message.content === "string" && message.content.length > 0) {
        content.push({
          type: message.role === "assistant" ? "output_text" : "input_text",
          text: message.content,
        });
      }
      if (content.length > 0) {
        items.push({
          type: "message",
          role: message.role,
          content,
        });
      }
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

function responseItemsToChat(items: Array<ResponseItem>): {
  message: ModelMessage;
  toolCalls?: Array<
    { id: string; name: string; args: Record<string, JSONValue> }
  >;
} {
  const textParts: Array<string> = [];
  const toolCalls: Array<
    { id: string; name: string; args: Record<string, JSONValue> }
  > = [];
  const messageToolCalls: ModelMessage["tool_calls"] = [];

  for (const item of items) {
    if (item.type === "message" && item.role === "assistant") {
      for (const part of item.content) {
        if (part.type === "output_text") {
          textParts.push(part.text);
        }
      }
    }
    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id,
        name: item.name,
        args: safeJson(item.arguments),
      });
      messageToolCalls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      });
    }
  }

  const content = textParts.length > 0 ? textParts.join("") : null;
  const message: ModelMessage = {
    role: "assistant",
    content,
    tool_calls: messageToolCalls.length > 0 ? messageToolCalls : undefined,
  };

  return {
    message,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

async function createResponse(
  client: OpenAIClient,
  request: CreateResponseRequest,
  onStreamEvent?: (event: ResponseEvent) => void,
): Promise<CreateResponseResponse> {
  const baseParams: Record<string, unknown> = {
    model: request.model,
    input: toOpenAIInputItems(request.input),
    instructions: request.instructions,
    tools: undefined,
    tool_choice: mapToolChoice(request.tool_choice),
    stream: request.stream,
    max_output_tokens: request.max_output_tokens,
    metadata: request.metadata,
  };
  const mappedTools = mapTools(request.tools) ?? [];
  appendSyntheticTools(mappedTools, request.input);
  if (mappedTools.length > 0) {
    baseParams.tools = mappedTools;
  }
  const params = { ...(request.params ?? {}), ...baseParams };
  const debugResponses = Deno.env.get("GAMBIT_DEBUG_RESPONSES") === "1";
  let responseOrStream: unknown;
  try {
    responseOrStream = await client.responses.create(
      params as unknown as OpenAI.Responses.ResponseCreateParams,
    );
  } catch (err) {
    if (debugResponses) {
      logger.error("[responses-debug] request", params);
      if (err instanceof OpenAI.APIError) {
        logger.error("[responses-debug] error", err.error);
      } else {
        logger.error("[responses-debug] error", err);
      }
    }
    throw err;
  }

  if (
    request.stream &&
    isAsyncIterable<OpenAI.Responses.ResponseStreamEvent>(responseOrStream)
  ) {
    let completed: CreateResponseResponse | null = null;
    for await (const event of responseOrStream) {
      if (!event || typeof event !== "object" || !("type" in event)) {
        continue;
      }
      switch (event.type) {
        case "response.created": {
          const mapped = normalizeOpenAIResponse(event.response);
          onStreamEvent?.({ type: "response.created", response: mapped });
          break;
        }
        case "response.output_text.delta":
          onStreamEvent?.({
            type: "response.output_text.delta",
            output_index: event.output_index,
            delta: event.delta,
            item_id: event.item_id,
          });
          break;
        case "response.output_text.done":
          onStreamEvent?.({
            type: "response.output_text.done",
            output_index: event.output_index,
            text: event.text,
            item_id: event.item_id,
          });
          break;
        case "response.output_item.added": {
          const item = mapOpenAIOutputItem(event.item);
          if (item) {
            onStreamEvent?.({
              type: "response.output_item.added",
              output_index: event.output_index,
              item,
            });
          }
          break;
        }
        case "response.output_item.done": {
          const item = mapOpenAIOutputItem(event.item);
          if (item) {
            onStreamEvent?.({
              type: "response.output_item.done",
              output_index: event.output_index,
              item,
            });
          }
          break;
        }
        case "response.completed": {
          completed = normalizeOpenAIResponse(event.response);
          onStreamEvent?.({ type: "response.completed", response: completed });
          break;
        }
        case "response.failed": {
          const error = mapError(event.response?.error ?? undefined);
          onStreamEvent?.({
            type: "response.failed",
            error: error ?? {},
          });
          break;
        }
        default:
          break;
      }
    }
    if (completed) return completed;
    throw new Error("Ollama responses stream ended without completion.");
  }

  return normalizeOpenAIResponse(
    responseOrStream as OpenAI.Responses.Response,
  );
}

export function createOllamaProvider(opts: {
  apiKey?: string;
  baseURL?: string;
  client?: OpenAIClient;
}): ModelProvider {
  const client = (opts.client ??
    new OpenAI({
      apiKey: opts.apiKey ?? "ollama",
      baseURL: opts.baseURL ?? "http://localhost:11434/v1",
    })) as OpenAIClient;

  return {
    async responses(input) {
      return await createResponse(client, input.request, input.onStreamEvent);
    },
    async chat(input) {
      const response = await createResponse(
        client,
        {
          model: input.model,
          input: chatMessagesToResponseItems(input.messages),
          tools: input.tools as Array<ResponseToolDefinition> | undefined,
          stream: input.stream,
          params: input.params ?? {},
        },
        (event) => {
          if (event.type === "response.output_text.delta") {
            input.onStreamText?.(event.delta);
          }
        },
      );
      const mapped = responseItemsToChat(response.output);
      return {
        message: mapped.message,
        finishReason: mapped.toolCalls ? "tool_calls" : "stop",
        toolCalls: mapped.toolCalls,
        usage: response.usage,
      };
    },
  };
}
