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
export const OPENROUTER_PREFIX = "openrouter/";

type OpenAIClient = {
  chat: {
    completions: {
      create: (
        params: unknown,
        options?: { signal?: AbortSignal },
      ) => Promise<unknown>;
    };
  };
  responses: {
    create: (
      params: unknown,
      options?: { signal?: AbortSignal },
    ) => Promise<unknown>;
  };
};

function normalizeOpenRouterModel(model: string): string {
  return model.startsWith(OPENROUTER_PREFIX)
    ? model.slice(OPENROUTER_PREFIX.length)
    : model;
}

function normalizeMessage(
  content: OpenAI.Chat.Completions.ChatCompletionMessage,
): ModelMessage {
  const toolCalls = (content.tool_calls as ModelMessage["tool_calls"]) ??
    undefined;
  return {
    role: content.role as ModelMessage["role"],
    content: typeof content.content === "string"
      ? content.content
      : Array.isArray(content.content)
      ? (content.content as Array<string | { text?: string }>)
        .map((c) => (typeof c === "string" ? c : ""))
        .join("")
      : "",
    name: (content as { name?: string }).name,
    tool_call_id: (content as { tool_call_id?: string }).tool_call_id,
    tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
  };
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
  const reasoningTokens = (usage as {
    output_tokens_details?: { reasoning_tokens?: number | null };
  }).output_tokens_details?.reasoning_tokens ?? undefined;
  const out: ResponseUsage = {
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
  if (typeof reasoningTokens === "number") {
    out.reasoningTokens = reasoningTokens;
  }
  return out;
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
    model: normalizeOpenRouterModel(request.model),
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
    throw new Error("OpenRouter responses stream ended without completion.");
  }

  return normalizeOpenAIResponse(
    responseOrStream as OpenAI.Responses.Response,
  );
}

export function createOpenRouterProvider(opts: {
  apiKey: string;
  baseURL?: string;
  referer?: string;
  title?: string;
  enableResponses?: boolean;
  client?: OpenAIClient;
}): ModelProvider {
  const debugStream = Deno.env.get("GAMBIT_DEBUG_STREAM") === "1";
  const client = (opts.client ??
    new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL ?? "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": opts.referer ?? "https://gambit.local",
        "X-Title": opts.title ?? "Gambit CLI",
      },
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
      const params = input.params ?? {};
      if (opts.enableResponses) {
        const response = await createResponse(
          client,
          {
            model: normalizeOpenRouterModel(input.model),
            input: chatMessagesToResponseItems(input.messages),
            tools: input.tools as Array<ResponseToolDefinition> | undefined,
            stream: input.stream,
            params,
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
      }

      if (input.stream) {
        if (debugStream) {
          logger.log(
            `[stream-debug] requesting stream model=${input.model} messages=${input.messages.length} tools=${
              input.tools?.length ?? 0
            }`,
          );
        }

        const stream = await client.chat.completions.create(
          {
            model: normalizeOpenRouterModel(input.model),
            messages: input
              .messages as Array<
                OpenAI.Chat.Completions.ChatCompletionMessageParam
              >,
            tools: input
              .tools as unknown as Array<
                OpenAI.Chat.Completions.ChatCompletionTool
              >,
            tool_choice: "auto",
            stream: true,
            ...(params as Record<string, unknown>),
          },
          input.signal ? { signal: input.signal } : undefined,
        ) as AsyncIterable<
          OpenAI.Chat.Completions.ChatCompletionChunk
        >;

        let finishReason: "stop" | "tool_calls" | "length" | null = null;
        const contentParts: Array<string> = [];
        const toolCallMap = new Map<
          number,
          {
            id?: string;
            function: { name?: string; arguments: string };
          }
        >();
        let chunkCount = 0;
        let streamedChars = 0;

        for await (
          const chunk of stream as AsyncIterable<
            OpenAI.Chat.Completions.ChatCompletionChunk
          >
        ) {
          chunkCount++;
          const choice = chunk.choices[0];
          const fr = choice.finish_reason;
          if (
            fr === "stop" || fr === "tool_calls" || fr === "length" ||
            fr === null
          ) {
            finishReason = fr ?? finishReason;
          }
          const delta = choice.delta;

          if (typeof delta.content === "string") {
            contentParts.push(delta.content);
            input.onStreamText?.(delta.content);
            streamedChars += delta.content.length;
          } else if (Array.isArray(delta.content)) {
            const chunkStr =
              (delta.content as Array<string | { text?: string }>)
                .map((c) => (typeof c === "string" ? c : ""))
                .join("");
            if (chunkStr) {
              contentParts.push(chunkStr);
              input.onStreamText?.(chunkStr);
              streamedChars += chunkStr.length;
            }
          }

          for (const tc of delta.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            const existing = toolCallMap.get(idx) ??
              {
                id: tc.id,
                function: { name: tc.function?.name, arguments: "" },
              };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.function.name = tc.function.name;
            if (tc.function?.arguments) {
              existing.function.arguments += tc.function.arguments;
            }
            toolCallMap.set(idx, existing);
          }
        }

        if (debugStream) {
          logger.log(
            `[stream-debug] completed stream chunks=${chunkCount} streamedChars=${streamedChars} finishReason=${finishReason}`,
          );
        }

        const tool_calls = Array.from(toolCallMap.values()).map((tc) => ({
          id: tc.id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 24),
          type: "function" as const,
          function: {
            name: tc.function.name ?? "",
            arguments: tc.function.arguments,
          },
        }));

        const message = normalizeMessage({
          role: "assistant",
          content: contentParts.length ? contentParts.join("") : null,
          tool_calls,
        } as OpenAI.Chat.Completions.ChatCompletionMessage);

        const toolCalls = tool_calls.length > 0
          ? tool_calls.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            args: safeJson(tc.function.arguments),
          }))
          : undefined;

        return {
          message,
          finishReason: finishReason ?? "stop",
          toolCalls,
        };
      }

      const response = await client.chat.completions.create(
        {
          model: normalizeOpenRouterModel(input.model),
          messages: input
            .messages as unknown as Array<
              OpenAI.Chat.Completions.ChatCompletionMessageParam
            >,
          tools: input
            .tools as unknown as Array<
              OpenAI.Chat.Completions.ChatCompletionTool
            >,
          tool_choice: "auto",
          stream: false,
          ...(params as Record<string, unknown>),
        },
        input.signal ? { signal: input.signal } : undefined,
      ) as OpenAI.Chat.Completions.ChatCompletion;

      const choice = response.choices[0];
      const message = choice.message;
      const normalizedMessage = normalizeMessage(message);
      const toolCalls = message.tool_calls?.map((
        tc: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
      ) => ({
        id: tc.id,
        name: tc.function.name,
        args: safeJson(tc.function.arguments),
      }));

      return {
        message: normalizedMessage,
        finishReason: (choice.finish_reason ?? "stop") as
          | "stop"
          | "tool_calls"
          | "length",
        toolCalls,
        usage: response.usage
          ? (() => {
            const usage = {
              promptTokens: response.usage.prompt_tokens ?? 0,
              completionTokens: response.usage.completion_tokens ?? 0,
              totalTokens: response.usage.total_tokens ?? 0,
            };
            const details = response.usage as {
              completion_tokens_details?: { reasoning_tokens?: number | null };
              output_tokens_details?: { reasoning_tokens?: number | null };
            };
            const value = details.completion_tokens_details
              ?.reasoning_tokens ??
              details.output_tokens_details?.reasoning_tokens;
            return typeof value === "number"
              ? { ...usage, reasoningTokens: value }
              : usage;
          })()
          : undefined,
      };
    },
  };
}
