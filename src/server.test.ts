import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type {
  ModelMessage,
  ModelProvider,
  OpenResponseCreateResponse,
  OpenResponseInput,
  OpenResponseItem,
  SavedState,
} from "@bolt-foundry/gambit-core";

function modImportPath() {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const modPath = path.resolve(here, "..", "mod.ts");
  return path.toFileUrl(modPath).href;
}

async function runSimulator(
  port: number,
  payload: Record<string, unknown>,
): Promise<{ runId?: string; sessionId?: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/simulator/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : res.statusText,
    );
  }
  return body as { runId?: string; sessionId?: string };
}

async function readStreamEvents(port: number, offset = 0) {
  const res = await fetch(
    `http://127.0.0.1:${port}/api/durable-streams/stream/gambit-simulator?offset=${offset}`,
  );
  if (!res.ok) {
    throw new Error(res.statusText);
  }
  const body = await res.json() as {
    events?: Array<{ offset?: number; data?: unknown }>;
  };
  return body.events ?? [];
}

type ChatHandlerInput = {
  model: string;
  messages: Array<ModelMessage>;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  params?: Record<string, unknown>;
  state?: SavedState;
};

type ChatHandlerResult = {
  message: ModelMessage;
  finishReason: "stop" | "tool_calls" | "length";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  updatedState?: SavedState;
};

function toModelMessages(input: OpenResponseInput): Array<ModelMessage> {
  const items = typeof input === "string"
    ? [{ type: "message", role: "user", content: input } as OpenResponseItem]
    : input ?? [];
  const out: Array<ModelMessage> = [];
  for (const item of items) {
    if (item.type !== "message") continue;
    const content = typeof item.content === "string" || item.content === null
      ? item.content
      : item.content
        .map((part) => {
          switch (part.type) {
            case "input_text":
            case "output_text":
            case "text":
            case "summary_text":
            case "reasoning_text":
              return part.text;
            case "refusal":
              return part.refusal;
            default:
              return "";
          }
        })
        .join("");
    out.push({
      role: item.role,
      content,
      name: item.name,
      tool_call_id: item.tool_call_id,
      tool_calls: item.tool_calls,
    });
  }
  return out;
}

function toResponseMessageItem(message: ModelMessage): OpenResponseItem {
  return {
    type: "message",
    role: message.role,
    content: message.content ?? null,
    name: message.name,
    tool_call_id: message.tool_call_id,
    tool_calls: message.tool_calls,
  };
}

function createChatLikeProvider(
  handler: (
    input: ChatHandlerInput,
  ) => ChatHandlerResult | Promise<ChatHandlerResult>,
): ModelProvider {
  return {
    responses: async (input) => {
      const result = await handler({
        model: input.model,
        messages: toModelMessages(input.input),
        stream: input.stream,
        onStreamText: input.onStreamEvent
          ? (chunk) =>
            input.onStreamEvent?.({
              type: "response.output_text.delta",
              delta: chunk,
            })
          : undefined,
        params: input.params,
        state: input.state,
      });
      return {
        id: "resp-test",
        output: [toResponseMessageItem(result.message)],
        finishReason: result.finishReason,
        usage: result.usage,
        updatedState: result.updatedState,
      };
    },
  };
}

Deno.test("simulator streams responses", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "ws.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const provider = createChatLikeProvider((input) => {
    input.onStreamText?.("h");
    input.onStreamText?.("i");
    return {
      message: { role: "assistant", content: "hi" },
      finishReason: "stop",
    };
  });

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  const port = (server.addr as Deno.NetAddr).port;

  const homepage = await fetch(`http://127.0.0.1:${port}/`);
  const html = await homepage.text();
  if (!html.includes('id="root"')) {
    throw new Error("Simulator HTML missing root mount");
  }

  await runSimulator(port, { input: "hello", stream: true });
  const events = await readStreamEvents(port, 0);
  const messages = events.map((event) =>
    event.data as { type?: string; chunk?: string; result?: unknown }
  );
  await server.shutdown();
  await server.finished;

  const resultMsg = messages.find((m) => m.type === "result");
  assertEquals(resultMsg?.result, "hi");
  const streams = messages.filter((m) => m.type === "stream").map((m) =>
    m.chunk ?? ""
  )
    .join("");
  assertEquals(streams, "hi");
  assertEquals(messages.some((m) => m.type === "result"), true);
});

Deno.test("responses endpoint streams Open Responses events", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "responses.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const provider: ModelProvider = {
    responses: (input) => {
      input.onStreamEvent?.({
        type: "response.output_text.delta",
        delta: "hi",
      });
      const response: OpenResponseCreateResponse = {
        id: "resp-test",
        output: [toResponseMessageItem({ role: "assistant", content: "hi" })],
        finishReason: "stop",
      };
      input.onStreamEvent?.({
        type: "response.completed",
        response,
      });
      return Promise.resolve(response);
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });
  const port = (server.addr as Deno.NetAddr).port;

  const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "dummy-model",
      input: "hello",
      stream: true,
    }),
  });
  const body = await res.text();

  await server.shutdown();
  await server.finished;

  assertEquals(res.status, 200);
  assert(body.includes("event: response.output_text.delta"));
  assert(body.includes("event: response.completed"));
  assert(body.includes("data: [DONE]"));
});

Deno.test("simulator exposes schema and defaults", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "schema.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({
        name: z.string().default("CallFlow"),
        mode: z.enum(["a", "b"]).describe("mode selector"),
        age: z.number().optional(),
      }),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const provider = createChatLikeProvider(() => ({
    message: { role: "assistant", content: "ok" },
    finishReason: "stop",
  }));

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  const port = (server.addr as Deno.NetAddr).port;

  const schemaRes = await fetch(`http://127.0.0.1:${port}/schema`);
  const schemaBody = await schemaRes.json() as {
    schema?: { kind?: string; fields?: Record<string, { kind?: string }> };
    defaults?: { name?: string };
  };

  assert(schemaBody.schema);
  assertEquals(schemaBody.schema?.kind, "object");
  assertEquals(schemaBody.defaults?.name, "CallFlow");
  await server.shutdown();
  await server.finished;
});

Deno.test("simulator preserves state and user input", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "stateful.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const calls: Array<{
    messages: Array<
      import("@bolt-foundry/gambit-core").ModelMessage
    >;
    state?: import("@bolt-foundry/gambit-core").SavedState;
  }> = [];

  const provider = createChatLikeProvider((input) => {
    calls.push({ messages: input.messages, state: input.state });
    const lastUser = [...input.messages].reverse().find((m) =>
      m.role === "user"
    );
    return {
      message: { role: "assistant", content: lastUser?.content ?? "ok" },
      finishReason: "stop",
    };
  });

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  const port = (server.addr as Deno.NetAddr).port;
  const first = await runSimulator(port, {
    input: "hello",
    message: "hello",
    stream: false,
  });
  await runSimulator(port, {
    input: "again",
    message: "again",
    stream: false,
    sessionId: first.sessionId,
  });
  await server.shutdown();
  await server.finished;

  assertEquals(calls.length, 2);

  const initMsg = calls[0].messages.find((m) =>
    m.tool_calls?.some((t) => t.function.name === "gambit_init")
  );
  if (!initMsg || !initMsg.tool_calls?.length) {
    throw new Error("missing gambit_init call");
  }
  const initArgs = JSON.parse(initMsg.tool_calls[0].function.arguments) as {
    input?: unknown;
    runId?: string;
  };
  assertEquals(initArgs, {});

  const initTool = calls[0].messages.find((m) =>
    m.role === "tool" && m.name === "gambit_init"
  );
  if (!initTool || !initTool.content) {
    throw new Error("missing gambit_init tool payload");
  }
  const initPayload = JSON.parse(initTool.content) as unknown;
  assertEquals(initPayload, "hello");

  const secondStateRunId = calls[1].state?.runId;
  if (!secondStateRunId) throw new Error("missing runId in saved state");

  const lastUser = [...calls[1].messages].reverse().find((m) =>
    m.role === "user"
  );
  assertEquals(lastUser?.content, "again");
});

Deno.test("simulator treats follow-up input as a user message when state exists", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "state-follow-up.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const calls: Array<{
    messages: Array<
      import("@bolt-foundry/gambit-core").ModelMessage
    >;
    state?: import("@bolt-foundry/gambit-core").SavedState;
  }> = [];

  const provider = createChatLikeProvider((input) => {
    calls.push({ messages: input.messages, state: input.state });
    const lastUser = [...input.messages].reverse().find((m) =>
      m.role === "user"
    );
    return {
      message: { role: "assistant", content: lastUser?.content ?? "no-user" },
      finishReason: "stop",
    };
  });

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  const port = (server.addr as Deno.NetAddr).port;
  const first = await runSimulator(port, { input: "context", stream: false });
  await runSimulator(port, {
    input: "follow-up",
    stream: false,
    sessionId: first.sessionId,
  });
  await server.shutdown();
  await server.finished;

  assertEquals(calls.length, 2);
  const secondLastUser = [...calls[1].messages].reverse().find((m) =>
    m.role === "user"
  );
  assertEquals(secondLastUser?.content, "follow-up");
});

Deno.test("simulator emits state updates for download", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "state-download.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const provider = createChatLikeProvider((input) => {
    const updatedState = {
      runId: input.state?.runId ?? "state-run",
      messages: input.messages.map(toResponseMessageItem),
      meta: { note: "saved" },
    };
    return {
      message: { role: "assistant", content: "ok" },
      finishReason: "stop",
      updatedState,
    };
  });

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  const port = (server.addr as Deno.NetAddr).port;
  await runSimulator(port, { input: "save-me", stream: false });
  const events = await readStreamEvents(port, 0);
  const stateEvent = [...events].reverse().find((event) =>
    (event.data as { type?: string })?.type === "state"
  );
  if (!stateEvent) throw new Error("missing state event");
  const state = (stateEvent.data as { state?: unknown }).state as {
    messages?: Array<unknown>;
    meta?: { note?: string };
    runId?: string;
  };
  await server.shutdown();
  await server.finished;

  assert((state.messages?.length ?? 0) > 0);
  assertEquals(state.meta?.note, "saved");
  assert(Boolean(state.runId));
});

Deno.test("simulator falls back when provider state lacks messages", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "fallback.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const calls: Array<{
    messages: Array<
      import("@bolt-foundry/gambit-core").ModelMessage
    >;
    state?: import("@bolt-foundry/gambit-core").SavedState;
  }> = [];

  const provider = createChatLikeProvider((input) => {
    calls.push({ messages: input.messages, state: input.state });
    const lastUser = [...input.messages].reverse().find((m) =>
      m.role === "user"
    );
    return {
      message: { role: "assistant", content: lastUser?.content ?? "ok" },
      finishReason: "stop",
      // Simulate a provider that returns a minimal state without messages.
      updatedState: {
        runId: input.state?.runId ?? "missing-messages",
      } as unknown as import("@bolt-foundry/gambit-core").SavedState,
    };
  });

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  const port = (server.addr as Deno.NetAddr).port;
  const first = await runSimulator(port, {
    input: "one",
    message: "one",
    stream: false,
  });
  await runSimulator(port, {
    input: "two",
    message: "two",
    stream: false,
    sessionId: first.sessionId,
  });
  await server.shutdown();
  await server.finished;

  assertEquals(calls.length, 2);
  const previousUser = calls[0].messages.find((m) =>
    m.role === "user" && m.content === "one"
  );
  if (!previousUser) {
    throw new Error("expected first user message");
  }

  // Second call should include the first exchange even though the provider
  // tried to clear messages in updatedState.
  const containsFirst = calls[1].messages.some((m) =>
    m.role === "assistant" && m.content === "one"
  );
  assertEquals(containsFirst, true);
  assertEquals(Boolean(calls[1].state?.runId), true);
});
