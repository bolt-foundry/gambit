import type {
  ModelProvider,
  OpenResponseContentPart,
  OpenResponseCreateRequest,
  OpenResponseCreateResponse,
  OpenResponseEvent,
  OpenResponseItem,
  OpenResponseUsage,
} from "@bolt-foundry/gambit-core";

type GeminiContentPart = { text?: string };

type GeminiContent = {
  role: "user" | "model";
  parts: Array<GeminiContentPart>;
};

type GeminiRequest = {
  contents: Array<GeminiContent>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
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

function extractSystemInstructions(items: Array<OpenResponseItem>): string {
  return items
    .filter(
      (item): item is Extract<OpenResponseItem, { type: "message" }> =>
        item.type === "message" &&
        (item.role === "system" || item.role === "developer"),
    )
    .map((item) => contentPartsToText(item.content))
    .filter((text) => text.length > 0)
    .join("\n");
}

function buildGeminiContents(
  items: Array<OpenResponseItem>,
): Array<GeminiContent> {
  const contents: Array<GeminiContent> = [];
  for (const item of items) {
    if (item.type !== "message") continue;
    if (item.role === "system" || item.role === "developer") continue;
    if (item.role === "tool") continue;
    const role = item.role === "assistant" ? "model" : "user";
    const text = contentPartsToText(item.content);
    contents.push({ role, parts: [{ text }] });
  }
  return contents;
}

function finishReasonToOpenResponse(
  reason: string | undefined,
): "stop" | "tool_calls" | "length" | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case "MAX_TOKENS":
      return "length";
    default:
      return "stop";
  }
}

function usageFromGemini(
  meta?: GeminiResponse["usageMetadata"],
): OpenResponseUsage | undefined {
  if (!meta) return undefined;
  const inputTokens = meta.promptTokenCount ?? 0;
  const outputTokens = meta.candidatesTokenCount ?? 0;
  const totalTokens = meta.totalTokenCount ?? inputTokens + outputTokens;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens: totalTokens,
  };
}

function toGeminiModel(model: string): string {
  if (model.startsWith("google/")) {
    return `models/${model.slice("google/".length)}`;
  }
  if (model.startsWith("models/")) return model;
  return `models/${model}`;
}

async function invokeGemini(
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

  const systemInstruction = extractSystemInstructions(items);
  const contents = buildGeminiContents(items);
  const request: GeminiRequest = {
    contents,
    generationConfig: {
      temperature: input.temperature,
      topP: input.top_p,
      maxOutputTokens: input.max_output_tokens,
    },
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
  };

  const url = `${baseURL.replace(/\/$/, "")}/${
    toGeminiModel(input.model)
  }:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-goog-api-key": apiKey,
    },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini error (${res.status}): ${body}`);
  }
  const payload = await res.json() as GeminiResponse;
  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? "")
    .join("") ?? "";
  const finishReason = finishReasonToOpenResponse(candidate?.finishReason);

  const outputItem: OpenResponseItem = {
    type: "message",
    role: "assistant",
    content: text,
  };
  const createdAt = Math.floor(Date.now() / 1000);
  return {
    id: randomId("resp"),
    object: "response",
    created_at: createdAt,
    completed_at: createdAt,
    status: finishReason === "length" ? "incomplete" : "completed",
    model: input.model,
    output: [outputItem],
    finishReason,
    usage: usageFromGemini(payload.usageMetadata),
  };
}

export function createGeminiProvider(opts: {
  apiKey: string;
  baseURL?: string;
}): ModelProvider {
  const baseURL = opts.baseURL ??
    "https://generativelanguage.googleapis.com/v1beta";

  return {
    async responses(input) {
      if (!input.stream) {
        return await invokeGemini(opts.apiKey, baseURL, input);
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

      const response = await invokeGemini(opts.apiKey, baseURL, {
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
