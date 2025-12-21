import OpenAI from "@openai/openai";
import type {
  JSONValue,
  ModelMessage,
  ModelProvider,
  ToolDefinition,
} from "../types.ts";

const logger = console;

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

export function createOpenRouterProvider(opts: {
  apiKey: string;
  baseURL?: string;
  referer?: string;
  title?: string;
}): ModelProvider {
  const debugStream = Deno.env.get("GAMBIT_DEBUG_STREAM") === "1";

  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL ?? "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": opts.referer ?? "https://gambit.local",
      "X-Title": opts.title ?? "Gambit CLI",
    },
  });

  return {
    async chat(input: {
      model: string;
      messages: Array<ModelMessage>;
      tools?: Array<ToolDefinition>;
      stream?: boolean;
      state?: import("../state.ts").SavedState;
      onStreamText?: (chunk: string) => void;
      params?: Record<string, unknown>;
    }) {
      const params = input.params ?? {};
      if (input.stream) {
        if (debugStream) {
          logger.log(
            `[stream-debug] requesting stream model=${input.model} messages=${input.messages.length} tools=${
              input.tools?.length ?? 0
            }`,
          );
        }

        const stream = await client.chat.completions.create({
          model: input.model,
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
        });

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
      });

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
        finishReason:
          (choice.finish_reason as "stop" | "tool_calls" | "length" | null) ??
            "stop",
        toolCalls,
        usage: response.usage
          ? {
            promptTokens: response.usage.prompt_tokens ?? 0,
            completionTokens: response.usage.completion_tokens ?? 0,
            totalTokens: response.usage.total_tokens ?? 0,
          }
          : undefined,
      };
    },
  };
}

function safeJson(str: string): Record<string, JSONValue> {
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, JSONValue>;
    }
  } catch {
    // ignore bad tool args
  }
  return {};
}
