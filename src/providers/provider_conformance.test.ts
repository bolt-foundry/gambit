import { assertEquals } from "@std/assert";
import type OpenAI from "@openai/openai";
import { createCodexProvider } from "./codex.ts";
import { createGoogleProvider } from "./google.ts";
import { createOllamaProvider } from "./ollama.ts";
import { createOpenRouterProvider } from "./openrouter.ts";

function buildResponseFixture(model: string): OpenAI.Responses.Response {
  return {
    id: "resp_1",
    object: "response",
    model,
    created_at: 1700000000,
    status: "completed",
    output_text: "ok",
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    output: [{
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "ok", annotations: [] }],
    }],
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    },
  } as OpenAI.Responses.Response;
}

function buildGoogleCompletionFixture(): OpenAI.Chat.Completions.ChatCompletion {
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
        content: "ok",
      },
    }],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  } as OpenAI.Chat.Completions.ChatCompletion;
}

Deno.test("provider conformance: openrouter responses forwards abort signal", async () => {
  let seenSignal: AbortSignal | undefined;
  const provider = createOpenRouterProvider({
    apiKey: "test",
    client: {
      responses: {
        create: (_params: unknown, options?: { signal?: AbortSignal }) => {
          seenSignal = options?.signal;
          return Promise.resolve(buildResponseFixture("openrouter/gpt-4o"));
        },
      },
      chat: {
        completions: {
          create: () => Promise.reject(new Error("chat not expected")),
        },
      },
    } as Parameters<typeof createOpenRouterProvider>[0]["client"],
  });
  const controller = new AbortController();

  await provider.responses?.({
    request: {
      model: "openrouter/gpt-4o",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      }],
    },
    signal: controller.signal,
  });

  assertEquals(seenSignal, controller.signal);
});

Deno.test("provider conformance: google responses forwards abort signal", async () => {
  let seenSignal: AbortSignal | undefined;
  const provider = createGoogleProvider({
    apiKey: "test",
    client: {
      chat: {
        completions: {
          create: (_params: unknown, options?: { signal?: AbortSignal }) => {
            seenSignal = options?.signal;
            return Promise.resolve(buildGoogleCompletionFixture());
          },
        },
      },
    } as Parameters<typeof createGoogleProvider>[0]["client"],
  });
  const controller = new AbortController();

  await provider.responses?.({
    request: {
      model: "google/gemini-1.5-flash",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      }],
    },
    signal: controller.signal,
  });

  assertEquals(seenSignal, controller.signal);
});

Deno.test("provider conformance: ollama responses forwards abort signal", async () => {
  let seenSignal: AbortSignal | undefined;
  const provider = createOllamaProvider({
    client: {
      responses: {
        create: (_params: unknown, options?: { signal?: AbortSignal }) => {
          seenSignal = options?.signal;
          return Promise.resolve(buildResponseFixture("ollama/llama3.2"));
        },
      },
    } as Parameters<typeof createOllamaProvider>[0]["client"],
  });
  const controller = new AbortController();

  await provider.responses?.({
    request: {
      model: "ollama/llama3.2",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      }],
    },
    signal: controller.signal,
  });

  assertEquals(seenSignal, controller.signal);
});

Deno.test("provider conformance: codex responses forwards abort signal", async () => {
  let seenSignal: AbortSignal | undefined;
  const provider = createCodexProvider({
    runCommand: ({ signal }) => {
      seenSignal = signal;
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new TextEncoder().encode(
          [
            JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
            JSON.stringify({
              type: "item.completed",
              item: { type: "agent_message", text: "ok" },
            }),
          ].join("\n"),
        ),
        stderr: new Uint8Array(),
      });
    },
  });
  const controller = new AbortController();

  await provider.responses?.({
    request: {
      model: "codex-cli/default",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      }],
    },
    signal: controller.signal,
  });

  assertEquals(seenSignal, controller.signal);
});
