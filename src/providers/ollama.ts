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
    create: (
      params: unknown,
      options?: { signal?: AbortSignal },
    ) => Promise<unknown>;
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

function mapReasoning(
  reasoning: CreateResponseRequest["reasoning"],
): Record<string, unknown> | undefined {
  if (!reasoning) return undefined;
  const out: Record<string, unknown> = {};
  if (reasoning.effort !== undefined) out.effort = reasoning.effort;
  if (reasoning.summary !== undefined) out.summary = reasoning.summary;
  return Object.keys(out).length > 0 ? out : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  const out = { ...input };
  for (const [key, value] of Object.entries(out)) {
    if (value === undefined) {
      delete out[key as keyof T];
    }
  }
  return out;
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
): Record<string, unknown> | string | undefined {
  if (!toolChoice) return undefined;
  if (
    toolChoice === "none" || toolChoice === "auto" ||
    toolChoice === "required"
  ) {
    return toolChoice;
  }
  if (toolChoice.type === "allowed_tools") {
    return {
      type: "allowed_tools",
      tools: toolChoice.tools,
      mode: toolChoice.mode ?? "auto",
    };
  }
  return { type: "function", name: toolChoice.function.name };
}

function mapResponseContentPart(
  part: { type?: string; text?: string },
): ResponseTextContent | null {
  if (!part || typeof part !== "object") return null;
  if (typeof part.text !== "string") return null;
  if (part.type === "output_text") {
    return { type: "output_text", text: part.text };
  }
  if (part.type === "summary_text") {
    return { type: "summary_text", text: part.text };
  }
  if (part.type === "reasoning_text") {
    return { type: "reasoning_text", text: part.text };
  }
  if (part.type === "input_text") {
    return { type: "input_text", text: part.text };
  }
  return null;
}

function mapOpenAIOutputItem(
  item: OpenAI.Responses.ResponseOutputItem,
): ResponseItem | null {
  const itemType = (item as { type?: string }).type;
  if (itemType === "message") {
    const message = item as OpenAI.Responses.ResponseOutputMessage;
    const content: Array<ResponseTextContent> = (message.content ?? [])
      .map((part) =>
        mapResponseContentPart(part as { type?: string; text?: string })
      )
      .filter((part): part is ResponseTextContent => Boolean(part));
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
  if (itemType === "reasoning") {
    const reasoning = item as {
      id?: string;
      content?: Array<{ type?: string; text?: string }>;
      summary?: Array<{ type?: string; text?: string }>;
      encrypted_content?: string | null;
    };
    const content = (reasoning.content ?? [])
      .map((part) => mapResponseContentPart(part))
      .filter((part): part is ResponseTextContent => Boolean(part));
    const summary = (reasoning.summary ?? [])
      .map((part) => mapResponseContentPart(part))
      .filter((part): part is ResponseTextContent => Boolean(part));
    return {
      type: "reasoning",
      id: reasoning.id,
      content: content.length > 0 ? content : undefined,
      summary,
      encrypted_content: reasoning.encrypted_content,
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
    created_at: response.created_at,
    created: response.created_at,
    completed_at: (response as { completed_at?: number | null }).completed_at ??
      null,
    previous_response_id: response.previous_response_id ?? null,
    instructions: response.instructions ?? null,
    reasoning: (response as { reasoning?: CreateResponseResponse["reasoning"] })
      .reasoning ?? null,
    status: mapStatus(response.status ?? undefined),
    output: outputItems,
    usage: mapUsage(response.usage),
    error: mapError(response.error) ?? null,
    metadata: (response as {
      metadata?: Record<string, JSONValue>;
    }).metadata,
    max_output_tokens: response.max_output_tokens ?? null,
    max_tool_calls:
      (response as { max_tool_calls?: number | null }).max_tool_calls ?? null,
    parallel_tool_calls:
      (response as { parallel_tool_calls?: boolean }).parallel_tool_calls,
    store: (response as { store?: boolean }).store,
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
          if (part.type === "summary_text") {
            return {
              type: "summary_text",
              text: part.text,
            };
          }
          if (part.type === "reasoning_text") {
            return {
              type: "reasoning_text",
              text: part.text,
            };
          }
          return null;
        })
        .filter((
          part,
        ): part is {
          type:
            | "input_text"
            | "output_text"
            | "summary_text"
            | "reasoning_text";
          text: string;
        } => Boolean(part));
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
      continue;
    }
    if (item.type === "reasoning") {
      mapped.push({
        type: "reasoning",
        id: item.id,
        content: (item.content ?? []).map((part) => ({
          type: part.type,
          text: part.text,
        })),
        summary: item.summary.map((part) => ({
          type: part.type,
          text: part.text,
        })),
        encrypted_content: item.encrypted_content ?? null,
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
  signal?: AbortSignal,
  onStreamEvent?: (event: ResponseEvent) => void,
): Promise<CreateResponseResponse> {
  const baseParams: Record<string, unknown> = {
    model: request.model,
    input: toOpenAIInputItems(request.input),
    instructions: request.instructions,
    tools: undefined,
    tool_choice: mapToolChoice(request.tool_choice),
    previous_response_id: request.previous_response_id,
    reasoning: mapReasoning(request.reasoning),
    parallel_tool_calls: request.parallel_tool_calls,
    max_tool_calls: request.max_tool_calls,
    store: request.store,
    include: request.include,
    text: request.text,
    stream_options: request.stream_options,
    background: request.background,
    truncation: request.truncation,
    service_tier: request.service_tier,
    top_logprobs: request.top_logprobs,
    safety_identifier: request.safety_identifier,
    prompt_cache_key: request.prompt_cache_key,
    temperature: request.temperature,
    top_p: request.top_p,
    frequency_penalty: request.frequency_penalty,
    presence_penalty: request.presence_penalty,
    stream: request.stream,
    max_output_tokens: request.max_output_tokens,
    metadata: request.metadata,
  };
  const mappedTools = mapTools(request.tools) ?? [];
  appendSyntheticTools(mappedTools, request.input);
  if (mappedTools.length > 0) {
    baseParams.tools = mappedTools;
  }
  const params = { ...(request.params ?? {}), ...stripUndefined(baseParams) };
  const debugResponses = Deno.env.get("GAMBIT_DEBUG_RESPONSES") === "1";
  let responseOrStream: unknown;
  try {
    responseOrStream = await client.responses.create(
      params as unknown as OpenAI.Responses.ResponseCreateParams,
      signal ? { signal } : undefined,
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
          onStreamEvent?.({
            type: "response.created",
            response: mapped,
            sequence_number: (event as { sequence_number?: number })
              .sequence_number,
          });
          break;
        }
        case "response.output_text.delta":
          onStreamEvent?.({
            type: "response.output_text.delta",
            output_index: event.output_index,
            delta: event.delta,
            item_id: event.item_id,
            content_index: event.content_index,
            sequence_number: (event as { sequence_number?: number })
              .sequence_number,
            logprobs: (event as {
              logprobs?: Array<{ token?: string; logprob?: number }>;
            }).logprobs,
          });
          break;
        case "response.output_text.done":
          onStreamEvent?.({
            type: "response.output_text.done",
            output_index: event.output_index,
            text: event.text,
            item_id: event.item_id,
            content_index: event.content_index,
            sequence_number: (event as { sequence_number?: number })
              .sequence_number,
          });
          break;
        case "response.output_item.added": {
          const item = mapOpenAIOutputItem(event.item);
          if (item) {
            onStreamEvent?.({
              type: "response.output_item.added",
              output_index: event.output_index,
              item,
              sequence_number: (event as { sequence_number?: number })
                .sequence_number,
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
              sequence_number: (event as { sequence_number?: number })
                .sequence_number,
            });
          }
          break;
        }
        case "response.reasoning.delta":
          if (typeof event.delta === "string") {
            onStreamEvent?.({
              type: "response.reasoning.delta",
              output_index: event.output_index,
              item_id: event.item_id,
              content_index: event.content_index,
              delta: event.delta,
              sequence_number: (event as { sequence_number?: number })
                .sequence_number,
              obfuscation: (event as { obfuscation?: string }).obfuscation,
            });
          }
          break;
        case "response.reasoning.done":
          onStreamEvent?.({
            type: "response.reasoning.done",
            output_index: event.output_index,
            item_id: event.item_id,
            content_index: event.content_index,
            text: event.text,
            sequence_number: (event as { sequence_number?: number })
              .sequence_number,
          });
          break;
        case "response.reasoning_summary_text.delta":
          if (typeof event.delta === "string") {
            onStreamEvent?.({
              type: "response.reasoning_summary_text.delta",
              output_index: event.output_index,
              item_id: event.item_id,
              summary_index: event.summary_index,
              delta: event.delta,
              sequence_number: (event as { sequence_number?: number })
                .sequence_number,
              obfuscation: (event as { obfuscation?: string }).obfuscation,
            });
          }
          break;
        case "response.reasoning_summary_text.done":
          onStreamEvent?.({
            type: "response.reasoning_summary_text.done",
            output_index: event.output_index,
            item_id: event.item_id,
            summary_index: event.summary_index,
            text: event.text,
            sequence_number: (event as { sequence_number?: number })
              .sequence_number,
          });
          break;
        case "response.reasoning_summary_part.added":
          if (
            event.part && typeof event.part === "object" &&
            "type" in event.part &&
            "text" in event.part &&
            typeof (event.part as { text?: unknown }).text === "string"
          ) {
            onStreamEvent?.({
              type: "response.reasoning_summary_part.added",
              output_index: event.output_index,
              item_id: event.item_id,
              summary_index: event.summary_index,
              part: event.part as ResponseTextContent,
              sequence_number: (event as { sequence_number?: number })
                .sequence_number,
            });
          }
          break;
        case "response.reasoning_summary_part.done":
          if (
            event.part && typeof event.part === "object" &&
            "type" in event.part &&
            "text" in event.part &&
            typeof (event.part as { text?: unknown }).text === "string"
          ) {
            onStreamEvent?.({
              type: "response.reasoning_summary_part.done",
              output_index: event.output_index,
              item_id: event.item_id,
              summary_index: event.summary_index,
              part: event.part as ResponseTextContent,
              sequence_number: (event as { sequence_number?: number })
                .sequence_number,
            });
          }
          break;
        case "response.completed": {
          completed = normalizeOpenAIResponse(event.response);
          onStreamEvent?.({
            type: "response.completed",
            response: completed,
            sequence_number: (event as { sequence_number?: number })
              .sequence_number,
          });
          break;
        }
        case "response.failed": {
          const error = mapError(event.response?.error ?? undefined);
          onStreamEvent?.({
            type: "response.failed",
            error: error ?? {},
            sequence_number: (event as { sequence_number?: number })
              .sequence_number,
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
      return await createResponse(
        client,
        input.request,
        input.signal,
        input.onStreamEvent,
      );
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
        input.signal,
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
