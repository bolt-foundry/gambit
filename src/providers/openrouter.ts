import OpenAI from "@openai/openai";
import type {
  ModelMessage,
  ModelProvider,
  OpenResponseContentPart,
  OpenResponseCreateRequest,
  OpenResponseCreateResponse,
  OpenResponseEvent,
  OpenResponseInput,
  OpenResponseItem,
} from "@bolt-foundry/gambit-core";

const logger = console;

function contentToChatCompletionContent(
  content: string | Array<OpenResponseContentPart> | null,
):
  | string
  | Array<OpenAI.Chat.Completions.ChatCompletionContentPart>
  | null {
  if (typeof content === "string" || content === null) return content;

  const textParts: Array<string> = [];
  const out: Array<OpenAI.Chat.Completions.ChatCompletionContentPart> = [];
  const flushText = () => {
    if (!textParts.length) return;
    out.push({ type: "text", text: textParts.join("") });
    textParts.length = 0;
  };

  for (const part of content) {
    switch (part.type) {
      case "input_image":
        if (part.image_url) {
          flushText();
          out.push({
            type: "image_url",
            image_url: {
              url: part.image_url,
              detail: part.detail,
            },
          });
        }
        break;
      case "input_file": {
        const label = part.file_url ?? part.filename;
        if (label) textParts.push(`[file] ${label}`);
        break;
      }
      case "input_video":
        textParts.push(`[video] ${part.video_url}`);
        break;
      case "refusal":
        textParts.push(part.refusal);
        break;
      case "input_text":
      case "output_text":
      case "text":
      case "summary_text":
      case "reasoning_text":
        textParts.push(part.text);
        break;
    }
  }

  if (!out.length) return textParts.join("");
  flushText();
  return out;
}

function contentPartsToText(
  content: string | Array<OpenResponseContentPart> | null,
): string | null {
  if (typeof content === "string" || content === null) return content;
  return content.map((part) => {
    switch (part.type) {
      case "input_text":
      case "output_text":
      case "text":
      case "summary_text":
      case "reasoning_text":
        return part.text;
      case "refusal":
        return part.refusal;
      case "input_file": {
        const label = part.file_url ?? part.filename;
        return label ? `[file] ${label}` : "";
      }
      case "input_video":
        return `[video] ${part.video_url}`;
      default:
        return "";
    }
  }).join("");
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

function normalizeInputItems(
  input: OpenResponseInput,
  instructions?: string | null,
): Array<OpenResponseItem> {
  const items = typeof input === "string"
    ? [
      {
        type: "message",
        role: "user",
        content: input,
      } satisfies OpenResponseItem,
    ]
    : input ?? [];
  if (instructions) {
    return [
      {
        type: "message",
        role: "system",
        content: instructions,
      },
      ...items,
    ];
  }
  return items;
}

function messagesFromResponseItems(
  items: Array<OpenResponseItem>,
): Array<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
  const messages: Array<OpenAI.Chat.Completions.ChatCompletionMessageParam> =
    [];
  for (const item of items) {
    if (item.type !== "message") continue;
    if (item.role === "tool") {
      if (!item.tool_call_id) continue;
      const content = contentPartsToText(item.content) ?? "";
      messages.push({
        role: "tool",
        content,
        tool_call_id: item.tool_call_id,
      });
      continue;
    }
    if (item.role === "assistant") {
      const content = contentPartsToText(item.content);
      messages.push({
        role: "assistant",
        content,
        ...(item.name ? { name: item.name } : {}),
        ...(item.tool_calls ? { tool_calls: item.tool_calls } : {}),
      });
      continue;
    }
    if (item.role === "user") {
      const content = contentToChatCompletionContent(item.content) ?? "";
      messages.push({
        role: "user",
        content,
        ...(item.name ? { name: item.name } : {}),
      });
      continue;
    }
    const content = contentPartsToText(item.content) ?? "";
    messages.push({
      role: item.role,
      content,
      ...(item.name ? { name: item.name } : {}),
    });
  }
  return messages;
}

function applyRequestParams(
  input: Parameters<ModelProvider["responses"]>[0],
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };
  const setParam = (key: string, value: unknown) => {
    if (value === undefined || out[key] !== undefined) return;
    out[key] = value;
  };
  setParam("temperature", input.temperature);
  setParam("top_p", input.top_p);
  setParam("frequency_penalty", input.frequency_penalty);
  setParam("presence_penalty", input.presence_penalty);
  setParam("max_tokens", input.max_output_tokens);
  setParam("top_logprobs", input.top_logprobs);
  setParam("parallel_tool_calls", input.parallel_tool_calls);
  if (input.tool_choice !== undefined && out.tool_choice === undefined) {
    if (typeof input.tool_choice === "string") {
      out.tool_choice = input.tool_choice === "required"
        ? "auto"
        : input.tool_choice;
    } else if (input.tool_choice.type === "function") {
      out.tool_choice = input.tool_choice.name
        ? {
          type: "function",
          function: { name: input.tool_choice.name },
        }
        : "auto";
    }
  }
  return out;
}

export function createOpenRouterProvider(opts: {
  apiKey: string;
  baseURL?: string;
  referer?: string;
  title?: string;
  useResponses?: boolean;
}): ModelProvider {
  const debugStream = Deno.env.get("GAMBIT_DEBUG_STREAM") === "1";
  const envFlag = Deno.env.get("OPENROUTER_USE_RESPONSES");
  const useResponses = opts.useResponses !== undefined
    ? opts.useResponses
    : envFlag === "0"
    ? false
    : envFlag === "1"
    ? true
    : true;

  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL ?? "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": opts.referer ?? "https://gambit.local",
      "X-Title": opts.title ?? "Gambit CLI",
    },
  });

  const openResponseEventTypes = new Set([
    "response.output_text.delta",
    "response.output_text.done",
    "response.output_item.added",
    "response.output_item.done",
    "response.content_part.added",
    "response.content_part.done",
    "response.function_call_arguments.delta",
    "response.function_call_arguments.done",
    "response.refusal.delta",
    "response.refusal.done",
    "response.reasoning.delta",
    "response.reasoning.done",
    "response.reasoning_summary_text.delta",
    "response.reasoning_summary_text.done",
    "response.reasoning_summary_part.added",
    "response.reasoning_summary_part.done",
    "response.created",
    "response.queued",
    "response.in_progress",
    "response.failed",
    "response.incomplete",
    "response.completed",
    "error",
  ]);

  type ResponsesRequestInput = OpenResponseCreateRequest & {
    onStreamEvent?: (event: OpenResponseEvent) => void;
  };

  const buildResponsesRequest = (input: ResponsesRequestInput) => {
    const {
      params: _params,
      state: _state,
      onStreamEvent: _onStreamEvent,
      ...request
    } = input;
    return request as OpenAI.Responses.ResponseCreateParams;
  };

  return {
    async responses(input) {
      if (useResponses) {
        const request = buildResponsesRequest(input);
        if (input.stream) {
          let sequence = 0;
          let terminalResponse: OpenResponseCreateResponse | undefined;
          const stream = await client.responses.create({
            ...request,
            stream: true,
          });
          for await (
            const event of stream as AsyncIterable<
              { type?: string; response?: OpenResponseCreateResponse }
            >
          ) {
            if (!event || !event.type) continue;
            if (openResponseEventTypes.has(event.type)) {
              const streamEvent = event as OpenResponseEvent;
              input.onStreamEvent?.({
                ...streamEvent,
                sequence_number: streamEvent.sequence_number ?? ++sequence,
              });
            }
            if (
              event.type === "response.completed" ||
              event.type === "response.failed" ||
              event.type === "response.incomplete"
            ) {
              terminalResponse = event.response as OpenResponseCreateResponse;
            }
          }
          if (!terminalResponse) {
            throw new Error(
              "OpenRouter responses stream ended without terminal response.",
            );
          }
          return terminalResponse;
        }
        return (await client.responses.create(
          request,
        ) as unknown) as OpenResponseCreateResponse;
      }

      const items = normalizeInputItems(
        input.input,
        input.instructions ?? null,
      );
      const messages = messagesFromResponseItems(items);
      const requestParams = applyRequestParams(input, input.params ?? {});
      const toolChoice = (requestParams.tool_choice as
        | OpenAI.Chat.Completions.ChatCompletionToolChoiceOption
        | undefined) ?? "auto";
      delete requestParams.tool_choice;
      if (input.stream) {
        if (debugStream) {
          logger.log(
            `[stream-debug] requesting stream model=${input.model} messages=${messages.length} tools=${
              input.tools?.length ?? 0
            }`,
          );
        }

        const responseId = crypto.randomUUID();
        const createdAt = Math.floor(Date.now() / 1000);
        const itemId = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
        let sequence = 0;
        const emit = (
          event: Parameters<NonNullable<typeof input.onStreamEvent>>[0],
        ) => {
          input.onStreamEvent?.({
            ...event,
            sequence_number: event.sequence_number ?? ++sequence,
          });
        };
        const responseSkeletonBase: OpenResponseCreateResponse = {
          id: responseId,
          object: "response",
          created_at: createdAt,
          model: input.model,
          previous_response_id: input.previous_response_id ?? null,
          instructions: input.instructions ?? null,
          tool_choice: input.tool_choice,
          truncation: input.truncation,
          parallel_tool_calls: input.parallel_tool_calls,
          text: input.text,
          max_output_tokens: input.max_output_tokens,
          max_tool_calls: input.max_tool_calls,
          store: input.store,
          background: input.background,
          service_tier: input.service_tier,
          metadata: input.metadata,
          safety_identifier: input.safety_identifier,
          prompt_cache_key: input.prompt_cache_key,
          tools: input.tools,
          output: [],
        };
        emit({
          type: "response.queued",
          response: { ...responseSkeletonBase, status: "queued" },
        });
        const responseSkeleton: OpenResponseCreateResponse = {
          ...responseSkeletonBase,
          status: "in_progress",
        };
        emit({ type: "response.created", response: responseSkeleton });
        emit({ type: "response.in_progress", response: responseSkeleton });
        emit({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "message",
            id: itemId,
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        });

        let stream:
          | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
          | null = null;
        try {
          stream = await client.chat.completions.create({
            model: input.model,
            messages: messages as Array<
              OpenAI.Chat.Completions.ChatCompletionMessageParam
            >,
            tools: input.tools as unknown as Array<
              OpenAI.Chat.Completions.ChatCompletionTool
            >,
            tool_choice: toolChoice,
            stream: true,
            ...(requestParams as Record<string, unknown>),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emit({ type: "error", error: { code: "openrouter_error", message } });
          emit({
            type: "response.failed",
            response: {
              ...responseSkeleton,
              status: "failed",
              error: { code: "openrouter_error", message },
            },
          });
          throw err;
        }

        let finishReason: "stop" | "tool_calls" | "length" | null = null;
        const contentParts: Array<string> = [];
        let contentPartStarted = false;
        const toolCallMap = new Map<
          number,
          {
            id?: string;
            function: { name?: string; arguments: string };
          }
        >();
        let chunkCount = 0;
        let streamedChars = 0;

        for await (const chunk of stream) {
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
            if (!contentPartStarted) {
              emit({
                type: "response.content_part.added",
                item_id: itemId,
                output_index: 0,
                content_index: 0,
                part: { type: "output_text", text: "" },
              });
              contentPartStarted = true;
            }
            contentParts.push(delta.content);
            emit({
              type: "response.output_text.delta",
              item_id: itemId,
              output_index: 0,
              content_index: 0,
              delta: delta.content,
            });
            streamedChars += delta.content.length;
          } else if (Array.isArray(delta.content)) {
            const chunkStr =
              (delta.content as Array<string | { text?: string }>)
                .map((c) => (typeof c === "string" ? c : ""))
                .join("");
            if (chunkStr) {
              if (!contentPartStarted) {
                emit({
                  type: "response.content_part.added",
                  item_id: itemId,
                  output_index: 0,
                  content_index: 0,
                  part: { type: "output_text", text: "" },
                });
                contentPartStarted = true;
              }
              contentParts.push(chunkStr);
              emit({
                type: "response.output_text.delta",
                item_id: itemId,
                output_index: 0,
                content_index: 0,
                delta: chunkStr,
              });
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
            if (!existing.id) {
              existing.id = tc.id ??
                crypto.randomUUID().replace(/-/g, "").slice(0, 24);
            }
            if (tc.function?.name) existing.function.name = tc.function.name;
            if (tc.function?.arguments) {
              existing.function.arguments += tc.function.arguments;
              emit({
                type: "response.function_call_arguments.delta",
                item_id: existing.id,
                output_index: 0,
                delta: tc.function.arguments,
              });
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
        for (const call of tool_calls) {
          emit({
            type: "response.function_call_arguments.done",
            item_id: call.id,
            output_index: 0,
            arguments: call.function.arguments,
          });
        }

        const text = contentParts.length ? contentParts.join("") : "";
        const outputPart: OpenResponseContentPart = {
          type: "output_text",
          text,
        };
        const message = normalizeMessage({
          role: "assistant",
          content: text.length > 0 ? text : null,
          tool_calls,
        } as OpenAI.Chat.Completions.ChatCompletionMessage);
        const outputItem: OpenResponseItem = {
          type: "message",
          id: itemId,
          status: "completed",
          role: message.role,
          content: text.length > 0 ? [outputPart] : null,
          name: message.name,
          tool_call_id: message.tool_call_id,
          tool_calls: message.tool_calls,
        };
        if (contentPartStarted && text.length > 0) {
          emit({
            type: "response.output_text.done",
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            text,
          });
          emit({
            type: "response.content_part.done",
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            part: outputPart,
          });
        }
        emit({
          type: "response.output_item.done",
          output_index: 0,
          item: outputItem,
        });

        const completedAt = Math.floor(Date.now() / 1000);
        const status = finishReason === "length" ? "incomplete" : "completed";
        const responseResource: OpenResponseCreateResponse = {
          ...responseSkeleton,
          completed_at: completedAt,
          status,
          output: [outputItem],
          finishReason: finishReason ?? "stop",
        };
        if (status === "incomplete") {
          emit({
            type: "response.incomplete",
            response: responseResource,
          });
        } else {
          emit({
            type: "response.completed",
            response: responseResource,
          });
        }

        return {
          ...responseResource,
        };
      }

      const response = await client.chat.completions.create({
        model: input.model,
        messages: messages as Array<
          OpenAI.Chat.Completions.ChatCompletionMessageParam
        >,
        tools: input.tools as unknown as Array<
          OpenAI.Chat.Completions.ChatCompletionTool
        >,
        tool_choice: toolChoice,
        stream: false,
        ...(requestParams as Record<string, unknown>),
      });

      const choice = response.choices[0];
      const message = choice.message;
      const normalizedMessage = normalizeMessage(message);

      const responseId = response.id ?? crypto.randomUUID();
      const createdAt = Math.floor(Date.now() / 1000);
      const outputItem: OpenResponseItem = {
        type: "message",
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 24),
        status: "completed",
        role: normalizedMessage.role,
        content: normalizedMessage.content,
        name: normalizedMessage.name,
        tool_call_id: normalizedMessage.tool_call_id,
        tool_calls: normalizedMessage.tool_calls,
      };

      const finishReason =
        (choice.finish_reason as "stop" | "tool_calls" | "length" | null) ??
          "stop";
      const status = finishReason === "length" ? "incomplete" : "completed";

      return {
        id: responseId,
        object: "response",
        created_at: createdAt,
        completed_at: createdAt,
        status,
        model: input.model,
        previous_response_id: input.previous_response_id ?? null,
        instructions: input.instructions ?? null,
        tool_choice: input.tool_choice,
        truncation: input.truncation,
        parallel_tool_calls: input.parallel_tool_calls,
        text: input.text,
        max_output_tokens: input.max_output_tokens,
        max_tool_calls: input.max_tool_calls,
        store: input.store,
        background: input.background,
        service_tier: input.service_tier,
        metadata: input.metadata,
        safety_identifier: input.safety_identifier,
        prompt_cache_key: input.prompt_cache_key,
        tools: input.tools,
        output: [outputItem],
        finishReason,
        usage: response.usage
          ? {
            input_tokens: response.usage.prompt_tokens ?? 0,
            output_tokens: response.usage.completion_tokens ?? 0,
            total_tokens: response.usage.total_tokens ?? 0,
            promptTokens: response.usage.prompt_tokens ?? 0,
            completionTokens: response.usage.completion_tokens ?? 0,
            totalTokens: response.usage.total_tokens ?? 0,
          }
          : undefined,
      };
    },
  };
}
