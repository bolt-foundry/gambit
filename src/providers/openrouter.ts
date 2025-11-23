import OpenAI from "@openai/openai";
import type { JSONValue, ModelMessage, ModelProvider, ToolDefinition } from "../types.ts";

function normalizeMessage(
  content: OpenAI.Chat.Completions.ChatCompletionMessage,
): ModelMessage {
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
    tool_calls: content.tool_calls as ModelMessage["tool_calls"],
  };
}

export function createOpenRouterProvider(opts: {
  apiKey: string;
  baseURL?: string;
}): ModelProvider {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL ?? "https://openrouter.ai/api/v1",
  });

  return {
    async chat(input: {
      model: string;
      messages: ModelMessage[];
      tools?: ToolDefinition[];
      stream?: boolean;
      state?: import("../state.ts").SavedState;
    }) {
      const response = await client.chat.completions.create({
        model: input.model,
        messages: input
          .messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        tools: input.tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
        tool_choice: "auto",
        stream: input.stream ?? false,
      });

      const choice = response.choices[0];
      const message = choice.message;
      const normalizedMessage = normalizeMessage(message);
      const toolCalls = message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: safeJson(tc.function.arguments),
      }));

      return {
        message: normalizedMessage,
        finishReason: (choice.finish_reason as "stop" | "tool_calls" | "length" | null) ??
          "stop",
        toolCalls,
        updatedState: input.state,
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
