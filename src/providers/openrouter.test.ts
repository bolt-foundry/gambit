import { assert, assertEquals } from "@std/assert";
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

Deno.test("openrouter responses maps output and usage", async () => {
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
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      }],
    },
  });

  assert(result);
  assertEquals(received?.["model"], "openrouter/gpt-4o");
  assertEquals(result.output[0].type, "message");
  assertEquals(result.output[1].type, "function_call");
  assertEquals(result.usage, {
    promptTokens: 3,
    completionTokens: 5,
    totalTokens: 8,
  });
});

Deno.test("openrouter chat uses responses when enabled", async () => {
  const client = {
    responses: {
      create: () => Promise.resolve(buildResponseFixture()),
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
    enableResponses: true,
  });

  const result = await provider.chat({
    model: "openrouter/gpt-4o",
    messages: [{ role: "user", content: "hi" }],
  });

  assertEquals(result.message.content, "Hello there.");
  assertEquals(result.finishReason, "tool_calls");
  assertEquals(result.toolCalls?.[0].args, { query: "hi" });
});
