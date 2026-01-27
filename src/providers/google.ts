import OpenAI from "@openai/openai";
import type {
  CreateResponseResponse,
  JSONValue,
  ModelMessage,
  ModelProvider,
  ResponseItem,
  ResponseMessageItem,
  ResponseToolChoice,
} from "@bolt-foundry/gambit-core";

export const GOOGLE_PREFIX = "google/";
const DEFAULT_GOOGLE_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";

type OpenAIClient = {
  chat: {
    completions: {
      create: (params: unknown) => Promise<unknown>;
    };
  };
};

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

function extractContent(
  content: OpenAI.Chat.Completions.ChatCompletionMessage["content"],
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<string | { text?: string }>)
      .map((part) => (typeof part === "string" ? part : part.text ?? ""))
      .join("");
  }
  return "";
}

function normalizeMessage(
  content: OpenAI.Chat.Completions.ChatCompletionMessage,
): ModelMessage {
  const toolCalls = (content.tool_calls as ModelMessage["tool_calls"]) ??
    undefined;
  return {
    role: content.role as ModelMessage["role"],
    content: extractContent(content.content),
    name: (content as { name?: string }).name,
    tool_call_id: (content as { tool_call_id?: string }).tool_call_id,
    tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function toToolChoice(
  choice: ResponseToolChoice | undefined,
): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "required") return choice;
  return { type: "function", function: { name: choice.function.name } };
}

function responseItemsToChatMessages(
  items: Array<ResponseItem>,
  instructions?: string,
): Array<ModelMessage> {
  const messages: Array<ModelMessage> = [];
  if (instructions) {
    messages.push({ role: "system", content: instructions });
  }
  for (const item of items) {
    if (item.type === "message") {
      const content = item.content
        .map((part) => part.text)
        .join("");
      messages.push({ role: item.role, content });
      continue;
    }
    if (item.type === "function_call") {
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
        content: item.output,
        tool_call_id: item.call_id,
      });
    }
  }
  return messages;
}

function responseItemsFromChatMessage(
  message: ModelMessage,
  toolCalls?: Array<
    { id: string; name: string; args: Record<string, JSONValue> }
  >,
): Array<ResponseItem> {
  const output: Array<ResponseItem> = [];
  if (typeof message.content === "string" && message.content.length > 0) {
    output.push(
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: message.content }],
      } satisfies ResponseMessageItem,
    );
  }
  if (toolCalls) {
    for (const call of toolCalls) {
      output.push({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.args),
      });
    }
  } else if (message.tool_calls) {
    for (const call of message.tool_calls) {
      output.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
  }
  return output;
}

function mapChatUsage(
  usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined,
): CreateResponseResponse["usage"] | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

export function createGoogleProvider(opts: {
  apiKey: string;
  baseURL?: string;
  client?: OpenAIClient;
}): ModelProvider {
  const client = (opts.client ??
    new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL ?? DEFAULT_GOOGLE_BASE_URL,
    })) as OpenAIClient;

  return {
    async responses(input) {
      const request = input.request;
      const params = { ...(request.params ?? {}) } as Record<string, unknown>;
      if (
        request.max_output_tokens !== undefined &&
        params.max_tokens === undefined
      ) {
        params.max_tokens = request.max_output_tokens;
      }
      const messages = responseItemsToChatMessages(
        request.input,
        request.instructions,
      );
      const toolChoice = toToolChoice(request.tool_choice);
      if (request.stream) {
        const stream = await client.chat.completions.create({
          model: request.model,
          messages: messages as Array<
            OpenAI.Chat.Completions.ChatCompletionMessageParam
          >,
          tools: request.tools as Array<
            OpenAI.Chat.Completions.ChatCompletionTool
          >,
          tool_choice: toolChoice ?? "auto",
          stream: true,
          ...(params as Record<string, unknown>),
        }) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

        const contentParts: Array<string> = [];
        const toolCallMap = new Map<
          number,
          { id?: string; function: { name?: string; arguments: string } }
        >();
        let responseId: string | undefined;
        let created: number | undefined;
        for await (const chunk of stream) {
          responseId = responseId ?? chunk.id;
          created = created ?? chunk.created;
          const choice = chunk.choices[0];
          const delta = choice.delta;
          if (typeof delta.content === "string") {
            contentParts.push(delta.content);
            input.onStreamEvent?.({
              type: "response.output_text.delta",
              output_index: 0,
              delta: delta.content,
            });
          } else if (Array.isArray(delta.content)) {
            const text = (delta.content as Array<string | { text?: string }>)
              .map((
                part,
              ) => (typeof part === "string" ? part : part.text ?? ""))
              .join("");
            if (text) {
              contentParts.push(text);
              input.onStreamEvent?.({
                type: "response.output_text.delta",
                output_index: 0,
                delta: text,
              });
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
        const output = responseItemsFromChatMessage(message, toolCalls);
        const response: CreateResponseResponse = {
          id: responseId ?? crypto.randomUUID(),
          object: "response",
          model: request.model,
          created,
          status: "completed",
          output,
        };
        input.onStreamEvent?.({ type: "response.completed", response });
        return response;
      }

      const response = await client.chat.completions.create({
        model: request.model,
        messages: messages as Array<
          OpenAI.Chat.Completions.ChatCompletionMessageParam
        >,
        tools: request.tools as Array<
          OpenAI.Chat.Completions.ChatCompletionTool
        >,
        tool_choice: toolChoice ?? "auto",
        stream: false,
        ...(params as Record<string, unknown>),
      }) as OpenAI.Chat.Completions.ChatCompletion;

      const choice = response.choices[0];
      const normalizedMessage = normalizeMessage(choice.message);
      const toolCalls = choice.message.tool_calls?.map((
        tc: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
      ) => ({
        id: tc.id,
        name: tc.function.name,
        args: safeJson(tc.function.arguments),
      }));
      return {
        id: response.id,
        object: "response",
        model: response.model,
        created: response.created,
        status: "completed",
        output: responseItemsFromChatMessage(normalizedMessage, toolCalls),
        usage: mapChatUsage(response.usage),
      };
    },
    async chat(input) {
      const params = input.params ?? {};
      if (input.stream) {
        const stream = await client.chat.completions.create({
          model: input.model,
          messages: input.messages as Array<
            OpenAI.Chat.Completions.ChatCompletionMessageParam
          >,
          tools: input
            .tools as unknown as Array<
              OpenAI.Chat.Completions.ChatCompletionTool
            >,
          tool_choice: "auto",
          stream: true,
          ...(params as Record<string, unknown>),
        }) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

        let finishReason: "stop" | "tool_calls" | "length" | null = null;
        const contentParts: Array<string> = [];
        const toolCallMap = new Map<
          number,
          {
            id?: string;
            function: { name?: string; arguments: string };
          }
        >();

        for await (const chunk of stream) {
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
          } else if (Array.isArray(delta.content)) {
            const chunkStr =
              (delta.content as Array<string | { text?: string }>)
                .map((c) => (typeof c === "string" ? c : c.text ?? ""))
                .join("");
            if (chunkStr) {
              contentParts.push(chunkStr);
              input.onStreamText?.(chunkStr);
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

      const response = await client.chat.completions.create({
        model: input.model,
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
      }) as OpenAI.Chat.Completions.ChatCompletion;

      const choice = response.choices[0];
      const message = normalizeMessage(choice.message);
      const toolCalls = choice.message.tool_calls?.map((
        tc: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
      ) => ({
        id: tc.id,
        name: tc.function.name,
        args: safeJson(tc.function.arguments),
      }));

      return {
        message,
        finishReason: (choice.finish_reason ?? "stop") as
          | "stop"
          | "tool_calls"
          | "length",
        toolCalls,
        usage: mapChatUsage(response.usage),
      };
    },
  };
}
