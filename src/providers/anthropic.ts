import type {
  ModelProvider,
  OpenResponseContentPart,
  OpenResponseCreateRequest,
  OpenResponseCreateResponse,
  OpenResponseEvent,
  OpenResponseItem,
  OpenResponseToolChoice,
  OpenResponseUsage,
} from "@bolt-foundry/gambit-core";

type AnthropicMessageParam = {
  role: "user" | "assistant";
  content: string;
};

type AnthropicRequest = {
  model: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  system?: string;
  messages: Array<AnthropicMessageParam>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
};

type AnthropicResponse = {
  id?: string;
  content?: Array<{ text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

function randomId(prefix: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}-${suffix}`;
}

function contentPartsToText(
  content: string | Array<OpenResponseContentPart> | null,
): string {
  if (typeof content === "string") return content;
  if (!content) return "";
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

const isMessageItem = (
  item: OpenResponseItem,
): item is Extract<OpenResponseItem, { type: "message" }> =>
  item.type === "message";

function extractSystemInstruction(
  items: Array<OpenResponseItem>,
): string | undefined {
  const text = items
    .filter(isMessageItem)
    .filter((item) => item.role === "system" || item.role === "developer")
    .map((item) => contentPartsToText(item.content))
    .filter((value) => value.length > 0)
    .join("\n");
  return text.length ? text : undefined;
}

function buildAnthropicMessages(
  items: Array<OpenResponseItem>,
): Array<AnthropicMessageParam> {
  const messages: Array<AnthropicMessageParam> = [];
  for (const item of items) {
    if (item.type !== "message") continue;
    if (item.role === "system" || item.role === "developer") continue;
    if (item.role === "tool") continue;
    const role = item.role === "assistant" ? "assistant" : "user";
    messages.push({
      role,
      content: contentPartsToText(item.content),
    });
  }
  return messages;
}

function toolChoiceFromOpenResponse(
  toolChoice: OpenResponseToolChoice | undefined,
): { type: "auto" | "any" | "tool"; name?: string } | undefined {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === "string") {
    if (toolChoice === "required") return { type: "any" };
    if (toolChoice === "none") return undefined;
    return { type: "auto" };
  }
  if (toolChoice.type === "function") {
    return toolChoice.name
      ? { type: "tool", name: toolChoice.name }
      : undefined;
  }
  return undefined;
}

function finishReasonFromStop(
  stop?: string,
): "stop" | "tool_calls" | "length" | undefined {
  if (!stop) return undefined;
  if (stop === "max_tokens") return "length";
  if (stop === "tool_use") return "tool_calls";
  return "stop";
}

function usageFromAnthropic(
  usage?: { input_tokens?: number; output_tokens?: number },
): OpenResponseUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const totalTokens = inputTokens + outputTokens;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens: totalTokens,
  };
}

function toAnthropicModel(model: string): string {
  if (model.startsWith("anthropic/")) return model.slice("anthropic/".length);
  return model;
}

async function invokeAnthropic(
  apiKey: string,
  baseURL: string,
  input: OpenResponseCreateRequest,
): Promise<OpenResponseCreateResponse> {
  const items = typeof input.input === "string"
    ? [
      {
        type: "message",
        role: "user",
        content: input.input,
      } as OpenResponseItem,
    ]
    : input.input ?? [];
  const system = extractSystemInstruction(items);
  const messages = buildAnthropicMessages(items);

  const tools = input.tools?.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? {},
  }));
  const toolChoice = toolChoiceFromOpenResponse(input.tool_choice);
  const request: AnthropicRequest = {
    model: toAnthropicModel(input.model),
    max_tokens: input.max_output_tokens ?? 1024,
    temperature: input.temperature,
    top_p: input.top_p,
    system,
    messages,
    tools,
    tool_choice: toolChoice,
  };

  const res = await fetch(`${baseURL.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic error (${res.status}): ${body}`);
  }
  const response = await res.json() as AnthropicResponse;
  const contentText = response.content
    ?.map((part) => part.text ?? "")
    .join("") ?? "";
  const finishReason = finishReasonFromStop(response.stop_reason);
  const status = finishReason === "length" ? "incomplete" : "completed";
  const outputItem: OpenResponseItem = {
    type: "message",
    role: "assistant",
    content: contentText,
  };
  const createdAt = Math.floor(Date.now() / 1000);
  return {
    id: response.id ?? randomId("resp"),
    object: "response",
    created_at: createdAt,
    completed_at: createdAt,
    status,
    model: input.model,
    output: [outputItem],
    finishReason,
    usage: usageFromAnthropic(response.usage),
  };
}

export function createAnthropicProvider(opts: {
  apiKey: string;
  baseURL?: string;
}): ModelProvider {
  const baseURL = opts.baseURL ?? "https://api.anthropic.com";

  return {
    async responses(input) {
      if (!input.stream) {
        return await invokeAnthropic(opts.apiKey, baseURL, input);
      }

      const responseId = randomId("resp");
      const createdAt = Math.floor(Date.now() / 1000);
      const itemId = randomId("item");
      let sequence = 0;
      const emit = (event: OpenResponseEvent) => {
        input.onStreamEvent?.({
          ...event,
          sequence_number: event.sequence_number ?? ++sequence,
        });
      };

      emit({
        type: "response.created",
        response: {
          id: responseId,
          object: "response",
          created_at: createdAt,
          status: "in_progress",
          model: input.model,
          output: [],
        },
      });
      emit({
        type: "response.in_progress",
        response: {
          id: responseId,
          object: "response",
          created_at: createdAt,
          status: "in_progress",
          model: input.model,
          output: [],
        },
      });
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

      const response = await invokeAnthropic(opts.apiKey, baseURL, {
        ...input,
        stream: false,
      });
      const text = (() => {
        const item = response.output[0];
        if (item?.type === "message") {
          return typeof item.content === "string" ? item.content ?? "" : "";
        }
        return "";
      })();
      if (text.length > 0) {
        emit({
          type: "response.content_part.added",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "" },
        });
        emit({
          type: "response.output_text.delta",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          delta: text,
        });
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
          part: { type: "output_text", text },
        });
      }
      emit({
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          id: itemId,
          status: "completed",
          role: "assistant",
          content: text ? [{ type: "output_text", text }] : null,
        },
      });
      emit({
        type: "response.completed",
        response: {
          ...response,
          id: responseId,
          created_at: createdAt,
        },
      });

      return response;
    },
  };
}
