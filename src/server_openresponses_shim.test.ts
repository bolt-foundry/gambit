import { assertEquals, assertStringIncludes } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type {
  CreateResponseRequest,
  ModelProvider,
} from "@bolt-foundry/gambit-core";
import { modImportPath } from "./server_test_utils.ts";

Deno.test("serve shim exposes /v1/responses non-stream endpoint", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = path.join(dir, "shim.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  let captured: CreateResponseRequest | undefined;
  const provider: ModelProvider = {
    chat() {
      throw new Error("chat should not be called");
    },
    responses(input) {
      captured = input.request;
      return Promise.resolve({
        id: "resp_1",
        object: "response",
        status: "completed",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello" }],
        }],
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openrouter/gpt-4o-mini",
        input: [{
          type: "message",
          role: "user",
          content: "Say hello.",
        }],
        tools: [{
          type: "function",
          name: "get_weather",
          description: "Get weather",
          parameters: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          },
        }],
      }),
    });
    assertEquals(res.status, 200);
    const body = await res.json() as { id?: string; object?: string };
    assertEquals(body.id, "resp_1");
    assertEquals(body.object, "response");
    assertEquals(captured?.model, "openrouter/gpt-4o-mini");
    assertEquals(captured?.input[0].type, "message");
    const firstMessage = captured?.input[0];
    if (firstMessage?.type !== "message") {
      throw new Error("Expected first input item to be message");
    }
    assertEquals(firstMessage.content[0].type, "input_text");
    assertEquals(firstMessage.content[0].text, "Say hello.");
    assertEquals(captured?.tools?.[0].type, "function");
    assertEquals(captured?.tools?.[0].function.name, "get_weather");
  } finally {
    await server.shutdown();
    await server.finished;
  }
});

Deno.test("serve shim streams /v1/responses as SSE", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = path.join(dir, "shim-stream.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const provider: ModelProvider = {
    chat() {
      throw new Error("chat should not be called");
    },
    responses(input) {
      input.onStreamEvent?.({
        type: "response.created",
        response: {
          id: "resp_stream",
          object: "response",
          status: "in_progress",
          output: [],
        },
      });
      input.onStreamEvent?.({
        type: "response.output_text.delta",
        output_index: 0,
        delta: "he",
      });
      input.onStreamEvent?.({
        type: "response.output_text.done",
        output_index: 0,
        text: "hello",
      });
      return Promise.resolve({
        id: "resp_stream",
        object: "response",
        status: "completed",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello" }],
        }],
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openrouter/gpt-4o-mini",
        input: [{ type: "message", role: "user", content: "hello?" }],
        stream: true,
      }),
    });
    assertEquals(res.status, 200);
    assertStringIncludes(
      res.headers.get("content-type") ?? "",
      "text/event-stream",
    );
    const text = await res.text();
    assertStringIncludes(text, '"type":"response.created"');
    assertStringIncludes(text, '"type":"response.output_text.delta"');
    assertStringIncludes(text, '"type":"response.completed"');
  } finally {
    await server.shutdown();
    await server.finished;
  }
});

Deno.test("serve shim forwards extended top-level responses fields", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = path.join(dir, "shim-extended.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  let captured: CreateResponseRequest | undefined;
  const provider: ModelProvider = {
    chat() {
      throw new Error("chat should not be called");
    },
    responses(input) {
      captured = input.request;
      return Promise.resolve({
        id: "resp_extended",
        object: "response",
        status: "completed",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        }],
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openrouter/gpt-4o-mini",
        input: [{ type: "message", role: "user", content: "hello" }],
        previous_response_id: "resp_prev",
        store: true,
        reasoning: { effort: "xhigh", summary: "detailed" },
        parallel_tool_calls: true,
        max_tool_calls: 3,
        temperature: 0.1,
        top_p: 0.7,
        frequency_penalty: 0.2,
        presence_penalty: 0.3,
        max_output_tokens: 123,
        include: ["reasoning.encrypted_content"],
        text: { format: { type: "json_object" }, verbosity: "high" },
        truncation: "auto",
        stream_options: { include_obfuscation: false },
        background: true,
        service_tier: "flex",
        top_logprobs: 5,
        metadata: { source: "shim-test" },
        safety_identifier: "safe-1",
        prompt_cache_key: "cache-1",
      }),
    });
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;

    assertEquals(captured?.previous_response_id, "resp_prev");
    assertEquals(captured?.store, true);
    assertEquals(captured?.reasoning?.effort, "xhigh");
    assertEquals(captured?.reasoning?.summary, "detailed");
    assertEquals(captured?.parallel_tool_calls, true);
    assertEquals(captured?.max_tool_calls, 3);
    assertEquals(captured?.temperature, 0.1);
    assertEquals(captured?.top_p, 0.7);
    assertEquals(captured?.frequency_penalty, 0.2);
    assertEquals(captured?.presence_penalty, 0.3);
    assertEquals(captured?.max_output_tokens, 123);
    assertEquals(captured?.include, ["reasoning.encrypted_content"]);
    assertEquals(captured?.truncation, "auto");
    assertEquals(captured?.background, true);
    assertEquals(captured?.service_tier, "flex");
    assertEquals(captured?.top_logprobs, 5);
    assertEquals(captured?.metadata, { source: "shim-test" });
    assertEquals(captured?.safety_identifier, "safe-1");
    assertEquals(captured?.prompt_cache_key, "cache-1");
    assertEquals(captured?.stream_options, { include_obfuscation: false });

    assertEquals(body.previous_response_id, "resp_prev");
    assertEquals(body.parallel_tool_calls, true);
    assertEquals(body.max_tool_calls, 3);
    assertEquals(body.max_output_tokens, 123);
    assertEquals(body.top_p, 0.7);
    assertEquals(body.frequency_penalty, 0.2);
    assertEquals(body.presence_penalty, 0.3);
    assertEquals(body.temperature, 0.1);
    assertEquals(body.truncation, "auto");
    assertEquals(body.background, true);
    assertEquals(body.service_tier, "flex");
    assertEquals(body.top_logprobs, 5);
    assertEquals(body.metadata, { source: "shim-test" });
    assertEquals(body.safety_identifier, "safe-1");
    assertEquals(body.prompt_cache_key, "cache-1");
  } finally {
    await server.shutdown();
    await server.finished;
  }
});
