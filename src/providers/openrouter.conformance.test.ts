import { assert, assertEquals, assertExists } from "@std/assert";
import type OpenAI from "@openai/openai";
import { createOpenRouterProvider } from "./openrouter.ts";

type OpenAIClient = NonNullable<
  Parameters<typeof createOpenRouterProvider>[0]["client"]
>;

function buildResponseFixture(): OpenAI.Responses.Response {
  return {
    id: "resp_1",
    object: "response",
    model: "openrouter/gpt-4o",
    created_at: 1700000000,
    status: "completed",
    output_text: "Hello there.",
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    output: [
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [
          { type: "output_text", text: "Hello there.", annotations: [] },
        ],
      },
      {
        type: "function_call",
        id: "tool_1",
        call_id: "call_1",
        name: "lookup",
        arguments: '{"query":"hi"}',
        status: "completed",
      },
    ],
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: {
      input_tokens: 3,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 8,
    },
  } as OpenAI.Responses.Response;
}

function asyncStream<T>(events: Array<T>): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

Deno.test("openrouter responses request mapping (conformance)", async () => {
  let received: Record<string, unknown> | null = null;
  const client = {
    responses: {
      create: (params: Record<string, unknown>) => {
        received = params;
        return Promise.resolve(buildResponseFixture());
      },
    },
    chat: {
      completions: {
        create: () => Promise.reject(new Error("chat not expected")),
      },
    },
  } as OpenAIClient;

  const provider = createOpenRouterProvider({
    apiKey: "test",
    client,
  });

  const result = await provider.responses?.({
    request: {
      model: "openrouter/gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: '{"ok":true}',
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            parameters: { query: { type: "string" } },
          },
        },
      ],
      tool_choice: "auto",
      metadata: { source: "test" },
      max_output_tokens: 128,
      params: { temperature: 0.2 },
    },
  });

  assert(result);
  assertEquals(received?.["model"], "gpt-4o");
  assertEquals(received?.["max_output_tokens"], 128);
  const metadata = received?.["metadata"] as
    | Record<string, unknown>
    | undefined;
  assertEquals(metadata?.source, "test");
  const temperature = received?.["temperature"] as number | undefined;
  assertEquals(temperature ?? null, 0.2);
  const input = (received?.["input"] ?? []) as Array<Record<string, unknown>>;
  assertEquals(input[0].type, "message");
  assertEquals(input[0].role, "user");
  assertEquals(
    (input[0].content as Array<Record<string, unknown>>)[0].type,
    "input_text",
  );
  assertEquals(input[1].type, "function_call_output");
});

Deno.test("openrouter responses stream mapping (conformance)", async () => {
  const createdResponse = buildResponseFixture();
  const streamEvents: Array<OpenAI.Responses.ResponseStreamEvent> = [
    {
      type: "response.created",
      response: createdResponse,
      sequence_number: 1,
    } as OpenAI.Responses.ResponseStreamEvent,
    {
      type: "response.output_text.delta",
      output_index: 0,
      item_id: "msg_1",
      delta: "Hello",
      content_index: 0,
      sequence_number: 2,
    } as OpenAI.Responses.ResponseStreamEvent,
    {
      type: "response.output_item.added",
      output_index: 1,
      item: createdResponse.output[1] as OpenAI.Responses.ResponseOutputItem,
      sequence_number: 3,
    } as OpenAI.Responses.ResponseStreamEvent,
    {
      type: "response.output_item.done",
      output_index: 1,
      item: createdResponse.output[1] as OpenAI.Responses.ResponseOutputItem,
      sequence_number: 4,
    } as OpenAI.Responses.ResponseStreamEvent,
    {
      type: "response.completed",
      response: createdResponse,
      sequence_number: 5,
    } as OpenAI.Responses.ResponseStreamEvent,
  ];

  const client = {
    responses: {
      create: () => Promise.resolve(asyncStream(streamEvents)),
    },
    chat: {
      completions: {
        create: () => Promise.reject(new Error("chat not expected")),
      },
    },
  } as OpenAIClient;

  const provider = createOpenRouterProvider({
    apiKey: "test",
    client,
  });

  const seen: Array<unknown> = [];
  const result = await provider.responses?.({
    request: {
      model: "openrouter/gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        },
      ],
      stream: true,
    },
    onStreamEvent: (event) => seen.push(event),
  });

  assert(result);
  assertEquals(result.output[0].type, "message");
  assertEquals(result.output[1].type, "function_call");
  assertExists(
    seen.find((event) =>
      (event as { type?: string }).type === "response.created"
    ),
  );
  assertExists(
    seen.find((event) =>
      (event as { type?: string }).type === "response.output_text.delta"
    ),
  );
  assertExists(
    seen.find((event) =>
      (event as { type?: string }).type === "response.output_item.added"
    ),
  );
  assertExists(
    seen.find((event) =>
      (event as { type?: string }).type === "response.completed"
    ),
  );
});

Deno.test("openrouter chat default path uses chat.completions", async () => {
  let chatCalled = false;
  let responsesCalled = false;
  const client = {
    responses: {
      create: () => {
        responsesCalled = true;
        return Promise.resolve(buildResponseFixture());
      },
    },
    chat: {
      completions: {
        create: () => {
          chatCalled = true;
          return Promise.resolve({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "hello",
                },
              },
            ],
          } as OpenAI.Chat.Completions.ChatCompletion);
        },
      },
    },
  } as OpenAIClient;

  const provider = createOpenRouterProvider({
    apiKey: "test",
    client,
  });

  const result = await provider.chat({
    model: "openrouter/gpt-4o",
    messages: [{ role: "user", content: "hi" }],
  });

  assertEquals(result.message.content, "hello");
  assertEquals(chatCalled, true);
  assertEquals(responsesCalled, false);
});
