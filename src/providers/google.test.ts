import { assert, assertEquals } from "@std/assert";
import type OpenAI from "@openai/openai";
import { createGoogleProvider } from "./google.ts";

type OpenAIClient = NonNullable<
  Parameters<typeof createGoogleProvider>[0]["client"]
>;

function buildChatCompletionFixture(): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "chat_1",
    object: "chat.completion",
    created: 1700000000,
    model: "google/gemini-1.5-flash",
    choices: [{
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: "Hello there.",
      },
    }],
    usage: {
      prompt_tokens: 3,
      completion_tokens: 5,
      total_tokens: 8,
    },
  } as OpenAI.Chat.Completions.ChatCompletion;
}

function buildToolChatCompletionFixture(): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "chat_2",
    object: "chat.completion",
    created: 1700000001,
    model: "google/gemini-1.5-flash",
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: {
            name: "lookup",
            arguments: '{"query":"hi"}',
          },
        }],
      },
    }],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
    },
  } as OpenAI.Chat.Completions.ChatCompletion;
}

Deno.test("google responses maps chat completion to response output", async () => {
  let received: Record<string, unknown> | null = null;
  const client = {
    chat: {
      completions: {
        create: (params: Record<string, unknown>) => {
          received = params;
          return Promise.resolve(buildChatCompletionFixture());
        },
      },
    },
  } as OpenAIClient;

  const provider = createGoogleProvider({
    apiKey: "test",
    client,
  });

  const result = await provider.responses?.({
    request: {
      model: "google/gemini-1.5-flash",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      }],
    },
  });

  assert(result);
  assertEquals(received?.["model"], "google/gemini-1.5-flash");
  assertEquals(result.output[0].type, "message");
  assertEquals(
    (result.output[0] as { content: Array<{ text: string }> }).content[0].text,
    "Hello there.",
  );
  assertEquals(result.usage, {
    promptTokens: 3,
    completionTokens: 5,
    totalTokens: 8,
  });
});

Deno.test("google chat returns tool calls", async () => {
  const client = {
    chat: {
      completions: {
        create: () => Promise.resolve(buildToolChatCompletionFixture()),
      },
    },
  } as OpenAIClient;

  const provider = createGoogleProvider({
    apiKey: "test",
    client,
  });

  const result = await provider.chat({
    model: "google/gemini-1.5-flash",
    messages: [{ role: "user", content: "hi" }],
  });

  assertEquals(result.finishReason, "tool_calls");
  assert(result.toolCalls);
  assertEquals(result.toolCalls[0].name, "lookup");
  assertEquals(result.toolCalls[0].args, { query: "hi" });
});
