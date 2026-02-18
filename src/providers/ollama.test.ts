import { assertEquals } from "@std/assert";
import type OpenAI from "@openai/openai";
import { createOllamaProvider, fetchOllamaTags } from "./ollama.ts";

type OpenAIClient = NonNullable<
  Parameters<typeof createOllamaProvider>[0]["client"]
>;

function buildResponseFixture(): OpenAI.Responses.Response {
  return {
    id: "resp_1",
    object: "response",
    model: "llama3.2",
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

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL) => {
    const url = input instanceof URL
      ? input.toString()
      : typeof input === "string"
      ? input
      : input.url;
    return Promise.resolve(handler(url));
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

Deno.test("fetchOllamaTags uses baseURL origin when no path prefix", async () => {
  let seen: string | null = null;
  const restore = mockFetch((url) => {
    seen = url;
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    await fetchOllamaTags("http://localhost:11434/v1");
  } finally {
    restore();
  }
  assertEquals(seen, "http://localhost:11434/api/tags");
});

Deno.test("fetchOllamaTags preserves baseURL path prefix", async () => {
  let seen: string | null = null;
  const restore = mockFetch((url) => {
    seen = url;
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    await fetchOllamaTags("https://host.boltfoundry.bflocal:8017/ollama/v1");
  } finally {
    restore();
  }
  assertEquals(
    seen,
    "https://host.boltfoundry.bflocal:8017/ollama/api/tags",
  );
});

Deno.test("ollama responses forwards abort signal to client", async () => {
  let seenSignal: AbortSignal | undefined;
  const client = {
    responses: {
      create: (_params: unknown, options?: { signal?: AbortSignal }) => {
        seenSignal = options?.signal;
        return Promise.resolve(buildResponseFixture());
      },
    },
  } as OpenAIClient;
  const provider = createOllamaProvider({
    client,
  });
  const controller = new AbortController();

  await provider.responses?.({
    request: {
      model: "ollama/llama3.2",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      }],
    },
    signal: controller.signal,
  });

  assertEquals(seenSignal, controller.signal);
});
