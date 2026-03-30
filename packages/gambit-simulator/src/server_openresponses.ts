import type {
  CreateResponseRequest,
  CreateResponseResponse,
  JSONValue,
  ModelProvider,
  ResponseEvent,
  ResponseItem,
  ResponseTextContent,
  ResponseToolChoice,
  ResponseToolDefinition,
} from "@bolt-foundry/gambit-core";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function parseBodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function toTextPart(
  role: "system" | "user" | "assistant",
  value: unknown,
): { type: "input_text" | "output_text"; text: string } | null {
  if (typeof value === "string") {
    return {
      type: role === "assistant" ? "output_text" : "input_text",
      text: value,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : "";
  if (!text) return null;
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "output_text") return { type: "output_text", text };
  if (type === "input_text") return { type: "input_text", text };
  return {
    type: role === "assistant" ? "output_text" : "input_text",
    text,
  };
}

function normalizeMessageItem(
  item: Record<string, unknown>,
): ResponseItem | null {
  const role = item.role;
  if (role !== "system" && role !== "user" && role !== "assistant") {
    throw new Error("message.role must be system, user, or assistant");
  }
  const rawContent = item.content;
  const content = Array.isArray(rawContent)
    ? rawContent.map((part) => toTextPart(role, part)).filter((
      part,
    ): part is { type: "input_text" | "output_text"; text: string } =>
      Boolean(part)
    )
    : [toTextPart(role, rawContent)].filter((
      part,
    ): part is { type: "input_text" | "output_text"; text: string } =>
      Boolean(part)
    );
  if (content.length === 0) {
    throw new Error("message.content must include text");
  }
  return {
    type: "message",
    role,
    content,
    id: typeof item.id === "string" ? item.id : undefined,
  };
}

function asJsonValue(value: unknown): JSONValue {
  if (
    value === null || typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => asJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, JSONValue> = {};
    for (
      const [key, entry] of Object.entries(value as Record<string, unknown>)
    ) {
      out[key] = asJsonValue(entry);
    }
    return out;
  }
  return String(value);
}

function normalizeInputItems(input: unknown): Array<ResponseItem> {
  if (typeof input === "string") {
    return [{
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: input }],
    }];
  }
  const arr = Array.isArray(input) ? input : [input];
  const items: Array<ResponseItem> = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("input items must be objects");
    }
    const item = raw as Record<string, unknown>;
    const type = typeof item.type === "string" ? item.type : "";
    if (type === "message") {
      const normalized = normalizeMessageItem(item);
      if (normalized) items.push(normalized);
      continue;
    }
    if (type === "function_call") {
      const callId = item.call_id;
      const name = item.name;
      const args = item.arguments;
      if (
        typeof callId !== "string" || typeof name !== "string" ||
        typeof args !== "string"
      ) {
        throw new Error(
          "function_call requires call_id, name, and arguments strings",
        );
      }
      items.push({
        type: "function_call",
        call_id: callId,
        name,
        arguments: args,
        id: typeof item.id === "string" ? item.id : undefined,
      });
      continue;
    }
    if (type === "function_call_output") {
      const callId = item.call_id;
      const output = item.output;
      if (typeof callId !== "string" || typeof output !== "string") {
        throw new Error(
          "function_call_output requires call_id and output strings",
        );
      }
      items.push({
        type: "function_call_output",
        call_id: callId,
        output,
        id: typeof item.id === "string" ? item.id : undefined,
      });
      continue;
    }
    if (type.includes(":")) {
      const data = Object.hasOwn(item, "data")
        ? asJsonValue(item.data)
        : Object.entries(item)
          .filter(([key]) => key !== "type" && key !== "id")
          .reduce((acc, [key, value]) => {
            acc[key] = asJsonValue(value);
            return acc;
          }, {} as Record<string, JSONValue>);
      items.push({
        type: type as `${string}:${string}`,
        id: typeof item.id === "string" ? item.id : undefined,
        data,
        // this predates the lint rule
      } as unknown as ResponseItem);
      continue;
    }
    throw new Error(`Unsupported input item type: ${type || "(missing type)"}`);
  }
  return items;
}

function normalizeTools(
  tools: unknown,
): Array<ResponseToolDefinition> | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const out: Array<ResponseToolDefinition> = [];
  for (const raw of tools) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("tools entries must be objects");
    }
    const item = raw as Record<string, unknown>;
    const type = typeof item.type === "string" ? item.type : "";
    if (type !== "function") continue;
    const nested = item.function;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const fn = nested as Record<string, unknown>;
      const name = fn.name;
      if (typeof name !== "string" || !name) {
        throw new Error("tool.function.name is required");
      }
      out.push({
        type: "function",
        function: {
          name,
          description: typeof fn.description === "string"
            ? fn.description
            : undefined,
          parameters: (fn.parameters &&
              typeof fn.parameters === "object" &&
              !Array.isArray(fn.parameters))
            ? fn.parameters as Record<string, JSONValue>
            : {},
        },
      });
      continue;
    }
    const name = item.name;
    if (typeof name !== "string" || !name) {
      throw new Error("tool.name is required");
    }
    out.push({
      type: "function",
      function: {
        name,
        description: typeof item.description === "string"
          ? item.description
          : undefined,
        parameters: (item.parameters &&
            typeof item.parameters === "object" &&
            !Array.isArray(item.parameters))
          ? item.parameters as Record<string, JSONValue>
          : {},
      },
    });
  }
  return out.length ? out : undefined;
}

function normalizeToolChoice(choice: unknown): ResponseToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "none" || choice === "auto" || choice === "required") {
    return choice;
  }
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    return undefined;
  }
  const record = choice as Record<string, unknown>;
  if (record.type === "allowed_tools" && Array.isArray(record.tools)) {
    const tools = record.tools
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }
        const tool = entry as Record<string, unknown>;
        if (tool.type !== "function" || typeof tool.name !== "string") {
          return null;
        }
        return { type: "function", name: tool.name } as const;
      })
      .filter((entry): entry is { type: "function"; name: string } =>
        Boolean(entry)
      );
    if (tools.length === 0) return undefined;
    const mode = record.mode === "none" || record.mode === "auto" ||
        record.mode === "required"
      ? record.mode
      : undefined;
    return { type: "allowed_tools", tools, mode };
  }
  if (record.type !== "function") return undefined;
  if (record.function && typeof record.function === "object") {
    const fn = record.function as Record<string, unknown>;
    if (typeof fn.name === "string" && fn.name.length > 0) {
      return { type: "function", function: { name: fn.name } };
    }
  }
  if (typeof record.name === "string" && record.name.length > 0) {
    return { type: "function", function: { name: record.name } };
  }
  return undefined;
}

function sseFrame(event: unknown): Uint8Array {
  const encoder = new TextEncoder();
  const type = event && typeof event === "object" && !Array.isArray(event) &&
      typeof (event as { type?: unknown }).type === "string"
    ? (event as { type: string }).type
    : null;
  if (type) {
    return encoder.encode(
      `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`,
    );
  }
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function toStrictContentPart(
  part: ResponseTextContent,
): Record<string, unknown> {
  if (part.type === "output_text") {
    return {
      type: "output_text",
      text: part.text,
      annotations: [],
      logprobs: [],
    };
  }
  return {
    type: part.type,
    text: part.text,
  };
}

function toStrictResponseItem(
  item: ResponseItem,
  index: number,
): Record<string, unknown> {
  if (item.type === "message") {
    return {
      type: "message",
      id: item.id ?? `msg_${index + 1}`,
      status: "completed",
      role: item.role,
      content: item.content.map((part) => toStrictContentPart(part)),
    };
  }
  if (item.type === "function_call") {
    return {
      type: "function_call",
      id: item.id ?? item.call_id,
      call_id: item.call_id,
      name: item.name,
      arguments: item.arguments,
      status: "completed",
    };
  }
  if (item.type === "function_call_output") {
    return {
      type: "function_call_output",
      id: item.id ?? `${item.call_id}_out`,
      call_id: item.call_id,
      output: item.output,
      status: "completed",
    };
  }
  if (item.type === "reasoning") {
    return {
      type: "reasoning",
      id: item.id ?? `rs_${index + 1}`,
      content: (item.content ?? []).map((part) => toStrictContentPart(part)),
      summary: item.summary.map((part) => toStrictContentPart(part)),
      encrypted_content: item.encrypted_content ?? null,
    };
  }
  return {
    type: item.type,
    id: item.id ?? `ext_${index + 1}`,
    data: item.data,
    status: "completed",
  };
}

function toStrictTools(
  tools: Array<ResponseToolDefinition> | undefined,
): Array<Record<string, unknown>> {
  if (!tools || tools.length === 0) return [];
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description ?? null,
    parameters: tool.function.parameters ?? null,
    strict: false,
  }));
}

function toStrictToolChoice(
  choice: CreateResponseRequest["tool_choice"],
): Record<string, unknown> | string {
  if (!choice) return "auto";
  if (choice === "none" || choice === "auto" || choice === "required") {
    return choice;
  }
  if (choice.type === "allowed_tools") {
    return {
      type: "allowed_tools",
      tools: choice.tools,
      mode: choice.mode ?? "auto",
    };
  }
  return { type: "function", name: choice.function.name };
}

function toStrictResponseResource(args: {
  request: CreateResponseRequest;
  response: CreateResponseResponse;
  statusOverride?: "in_progress" | "completed" | "failed";
}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const createdAt = args.response.created_at ?? args.response.created ?? now;
  const status = args.statusOverride ?? args.response.status ?? "completed";
  const usage = args.response.usage
    ? {
      input_tokens: args.response.usage.promptTokens ?? 0,
      output_tokens: args.response.usage.completionTokens ?? 0,
      total_tokens: args.response.usage.totalTokens ?? 0,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens_details: {
        reasoning_tokens: args.response.usage.reasoningTokens ?? 0,
      },
    }
    : null;

  return {
    id: args.response.id,
    object: "response",
    created_at: createdAt,
    completed_at: status === "completed" ? now : null,
    status,
    incomplete_details: null,
    model: args.response.model ?? args.request.model,
    previous_response_id: args.request.previous_response_id ?? null,
    instructions: args.request.instructions ?? null,
    output: (args.response.output ?? []).map((item, idx) =>
      toStrictResponseItem(item, idx)
    ),
    error: args.response.error ?? null,
    tools: toStrictTools(args.request.tools),
    tool_choice: toStrictToolChoice(args.request.tool_choice),
    truncation: args.response.truncation ?? args.request.truncation ??
      "disabled",
    parallel_tool_calls: args.response.parallel_tool_calls ??
      args.request.parallel_tool_calls ?? false,
    text: args.response.text
      ? asJsonValue(args.response.text)
      : args.request.text
      ? asJsonValue(args.request.text)
      : { format: { type: "text" } },
    top_p: args.response.top_p ?? args.request.top_p ?? 1,
    presence_penalty: args.response.presence_penalty ??
      args.request.presence_penalty ?? 0,
    frequency_penalty: args.response.frequency_penalty ??
      args.request.frequency_penalty ?? 0,
    top_logprobs: args.response.top_logprobs ?? args.request.top_logprobs ?? 0,
    temperature: args.response.temperature ?? args.request.temperature ?? 1,
    reasoning: args.request.reasoning
      ? {
        effort: args.request.reasoning.effort ?? null,
        summary: args.request.reasoning.summary ?? null,
      }
      : null,
    usage,
    max_output_tokens: args.request.max_output_tokens ?? null,
    max_tool_calls: args.request.max_tool_calls ?? null,
    store: args.response.store ?? args.request.store ?? false,
    background: args.response.background ?? args.request.background ?? false,
    service_tier: args.response.service_tier ?? args.request.service_tier ??
      "default",
    metadata: args.request.metadata ? asJsonValue(args.request.metadata) : {},
    safety_identifier: args.response.safety_identifier ??
      args.request.safety_identifier ?? null,
    prompt_cache_key: args.response.prompt_cache_key ??
      args.request.prompt_cache_key ?? null,
  };
}

export async function handleOpenResponsesRequest(args: {
  req: Request;
  modelProvider: ModelProvider;
}): Promise<Response | null> {
  const url = new URL(args.req.url);
  if (url.pathname !== "/v1/responses") return null;
  if (args.req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!args.modelProvider.responses) {
    return jsonResponse(
      { error: "Configured provider does not support responses." },
      501,
    );
  }
  try {
    const body = parseBodyObject(await args.req.json());
    const model = typeof body.model === "string" ? body.model : undefined;
    if (!model) {
      throw new Error("model is required");
    }
    const input = normalizeInputItems(body.input);
    const stream = body.stream === true;
    const instructions = typeof body.instructions === "string"
      ? body.instructions
      : undefined;
    const previousResponseId = typeof body.previous_response_id === "string"
      ? body.previous_response_id
      : undefined;
    const store = typeof body.store === "boolean" ? body.store : undefined;
    const tools = normalizeTools(body.tools);
    const toolChoice = normalizeToolChoice(body.tool_choice);
    const reasoning = (body.reasoning &&
        typeof body.reasoning === "object" &&
        !Array.isArray(body.reasoning))
      ? body.reasoning as CreateResponseRequest["reasoning"]
      : undefined;
    const parallelToolCalls = typeof body.parallel_tool_calls === "boolean"
      ? body.parallel_tool_calls
      : undefined;
    const maxToolCalls = typeof body.max_tool_calls === "number"
      ? body.max_tool_calls
      : undefined;
    const temperature = typeof body.temperature === "number"
      ? body.temperature
      : undefined;
    const topP = typeof body.top_p === "number" ? body.top_p : undefined;
    const frequencyPenalty = typeof body.frequency_penalty === "number"
      ? body.frequency_penalty
      : undefined;
    const presencePenalty = typeof body.presence_penalty === "number"
      ? body.presence_penalty
      : undefined;
    const maxOutputTokens = typeof body.max_output_tokens === "number"
      ? body.max_output_tokens
      : undefined;
    const topLogprobs = typeof body.top_logprobs === "number"
      ? body.top_logprobs
      : undefined;
    const truncation = body.truncation === "auto" ||
        body.truncation === "disabled"
      ? body.truncation
      : undefined;
    const text = (body.text && typeof body.text === "object" &&
        !Array.isArray(body.text))
      ? body.text as CreateResponseRequest["text"]
      : undefined;
    const streamOptions = (body.stream_options &&
        typeof body.stream_options === "object" &&
        !Array.isArray(body.stream_options))
      ? body.stream_options as CreateResponseRequest["stream_options"]
      : undefined;
    const background = typeof body.background === "boolean"
      ? body.background
      : undefined;
    const include = Array.isArray(body.include)
      ? body.include.filter((entry): entry is string =>
        typeof entry === "string"
      )
      : undefined;
    const serviceTier = body.service_tier === "auto" ||
        body.service_tier === "default" || body.service_tier === "flex" ||
        body.service_tier === "priority"
      ? body.service_tier
      : undefined;
    const metadata = (body.metadata &&
        typeof body.metadata === "object" &&
        !Array.isArray(body.metadata))
      ? body.metadata as Record<string, JSONValue>
      : undefined;
    const safetyIdentifier = typeof body.safety_identifier === "string"
      ? body.safety_identifier
      : undefined;
    const promptCacheKey = typeof body.prompt_cache_key === "string"
      ? body.prompt_cache_key
      : undefined;
    const passthrough: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (
        key === "model" || key === "input" || key === "stream" ||
        key === "instructions" || key === "tools" ||
        key === "tool_choice" || key === "max_output_tokens" ||
        key === "previous_response_id" || key === "store" ||
        key === "reasoning" || key === "parallel_tool_calls" ||
        key === "max_tool_calls" || key === "temperature" ||
        key === "top_p" || key === "frequency_penalty" ||
        key === "presence_penalty" || key === "include" ||
        key === "text" || key === "stream_options" ||
        key === "background" || key === "truncation" ||
        key === "service_tier" || key === "top_logprobs" ||
        key === "metadata" || key === "safety_identifier" ||
        key === "prompt_cache_key" || key === "params"
      ) {
        continue;
      }
      passthrough[key] = value;
    }
    const explicitParams = (body.params &&
        typeof body.params === "object" &&
        !Array.isArray(body.params))
      ? body.params as Record<string, unknown>
      : undefined;
    const params = explicitParams || Object.keys(passthrough).length > 0
      ? { ...(explicitParams ?? {}), ...passthrough }
      : undefined;
    const requestBody: CreateResponseRequest = {
      model,
      input,
      instructions,
      previous_response_id: previousResponseId,
      store,
      tools,
      tool_choice: toolChoice,
      reasoning,
      parallel_tool_calls: parallelToolCalls,
      max_tool_calls: maxToolCalls,
      temperature,
      top_p: topP,
      frequency_penalty: frequencyPenalty,
      presence_penalty: presencePenalty,
      stream,
      stream_options: streamOptions,
      max_output_tokens: maxOutputTokens,
      top_logprobs: topLogprobs,
      truncation,
      text,
      include,
      background,
      service_tier: serviceTier,
      metadata,
      safety_identifier: safetyIdentifier,
      prompt_cache_key: promptCacheKey,
      params,
    };

    if (!stream) {
      const response = await args.modelProvider.responses({
        request: requestBody,
      });
      return jsonResponse(
        toStrictResponseResource({
          request: requestBody,
          response,
        }),
      );
    }

    const streamBody = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        let sequence = 1;
        const itemIdByOutputIndex = new Map<number, string>();
        const streamRequest: CreateResponseRequest = {
          ...requestBody,
          stream: true,
        };
        try {
          const result = await args.modelProvider.responses!({
            request: streamRequest,
            onStreamEvent: (event: ResponseEvent) => {
              if (event.type === "response.created") {
                controller.enqueue(
                  sseFrame({
                    type: "response.created",
                    sequence_number: sequence++,
                    response: toStrictResponseResource({
                      request: streamRequest,
                      response: event.response,
                      statusOverride: "in_progress",
                    }),
                  }),
                );
                return;
              }
              if (event.type === "response.output_text.delta") {
                const itemId = event.item_id ??
                  itemIdByOutputIndex.get(event.output_index) ??
                  `msg_${event.output_index + 1}`;
                itemIdByOutputIndex.set(event.output_index, itemId);
                controller.enqueue(
                  sseFrame({
                    type: "response.output_text.delta",
                    sequence_number: sequence++,
                    output_index: event.output_index,
                    item_id: itemId,
                    content_index: event.content_index ?? 0,
                    delta: event.delta,
                    logprobs: event.logprobs ?? [],
                  }),
                );
                return;
              }
              if (event.type === "response.output_text.done") {
                const itemId = event.item_id ??
                  itemIdByOutputIndex.get(event.output_index) ??
                  `msg_${event.output_index + 1}`;
                itemIdByOutputIndex.set(event.output_index, itemId);
                controller.enqueue(
                  sseFrame({
                    type: "response.output_text.done",
                    sequence_number: sequence++,
                    output_index: event.output_index,
                    item_id: itemId,
                    content_index: event.content_index ?? 0,
                    text: event.text,
                    logprobs: [],
                  }),
                );
                return;
              }
              if (event.type === "response.completed") {
                controller.enqueue(
                  sseFrame({
                    type: "response.completed",
                    sequence_number: sequence++,
                    response: toStrictResponseResource({
                      request: streamRequest,
                      response: event.response,
                      statusOverride: "completed",
                    }),
                  }),
                );
                return;
              }
              if (event.type === "response.failed") {
                controller.enqueue(
                  sseFrame({
                    type: "response.failed",
                    sequence_number: sequence++,
                    response: {
                      ...toStrictResponseResource({
                        request: streamRequest,
                        response: {
                          id: `resp_${crypto.randomUUID().slice(0, 8)}`,
                          object: "response",
                          output: [],
                          status: "failed",
                          error: event.error ??
                            { message: "Unknown error" },
                        },
                        statusOverride: "failed",
                      }),
                      error: event.error ?? { message: "Unknown error" },
                    },
                  }),
                );
              }
            },
          });
          controller.enqueue(
            sseFrame({
              type: "response.completed",
              sequence_number: sequence++,
              response: toStrictResponseResource({
                request: streamRequest,
                response: result,
                statusOverride: "completed",
              }),
            }),
          );
          controller.enqueue(
            new TextEncoder().encode("data: [DONE]\n\n"),
          );
        } catch (err) {
          controller.enqueue(
            sseFrame({
              type: "error",
              code: "internal_error",
              message: err instanceof Error ? err.message : String(err),
              param: null,
            }),
          );
        } finally {
          controller.close();
        }
      },
    });
    return new Response(streamBody, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      },
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
}
