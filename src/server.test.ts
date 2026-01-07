import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core/internal/types";

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

  const provider: ModelProvider = {
    chat(input) {
      input.onStreamText?.("h");
      input.onStreamText?.("i");
      return Promise.resolve({
        message: { role: "assistant", content: "hi" },
        finishReason: "stop",
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  const port = (server.addr as Deno.NetAddr).port;

  const homepage = await fetch(`http://127.0.0.1:${port}/`);
  const html = await homepage.text();
  if (!html.includes("Gambit Simulator Debug")) {
    throw new Error("Debug page missing expected content");
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

  const provider: ModelProvider = {
    chat() {
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

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
      import("@bolt-foundry/gambit-core/internal/types").ModelMessage
    >;
    state?: import("@bolt-foundry/gambit-core/internal/state").SavedState;
  }> = [];

  const provider: ModelProvider = {
    chat(input) {
      calls.push({ messages: input.messages, state: input.state });
      const lastUser = [...input.messages].reverse().find((m) =>
        m.role === "user"
      );
      return Promise.resolve({
        message: { role: "assistant", content: lastUser?.content ?? "ok" },
        finishReason: "stop",
      });
    },
  };

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
      import("@bolt-foundry/gambit-core/internal/types").ModelMessage
    >;
    state?: import("@bolt-foundry/gambit-core/internal/state").SavedState;
  }> = [];

  const provider: ModelProvider = {
    chat(input) {
      calls.push({ messages: input.messages, state: input.state });
      const lastUser = [...input.messages].reverse().find((m) =>
        m.role === "user"
      );
      return Promise.resolve({
        message: { role: "assistant", content: lastUser?.content ?? "no-user" },
        finishReason: "stop",
      });
    },
  };

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

  const provider: ModelProvider = {
    chat(input) {
      const updatedState = {
        runId: input.state?.runId ?? "state-run",
        messages: input.messages,
        meta: { note: "saved" },
      };
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
        updatedState,
      });
    },
  };

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
      import("@bolt-foundry/gambit-core/internal/types").ModelMessage
    >;
    state?: import("@bolt-foundry/gambit-core/internal/state").SavedState;
  }> = [];

  const provider: ModelProvider = {
    chat(input) {
      calls.push({ messages: input.messages, state: input.state });
      const lastUser = [...input.messages].reverse().find((m) =>
        m.role === "user"
      );
      return Promise.resolve({
        message: { role: "assistant", content: lastUser?.content ?? "ok" },
        finishReason: "stop",
        // Simulate a provider that returns a minimal state without messages.
        updatedState: {
          runId: input.state?.runId ?? "missing-messages",
        } as unknown as import("@bolt-foundry/gambit-core/internal/state").SavedState,
      });
    },
  };

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
  const previousAssistant = calls[0].messages.find((m) =>
    m.role === "assistant" && m.content === "one"
  );
  if (!previousAssistant) {
    throw new Error("expected first assistant message");
  }

  // Second call should include the first exchange even though the provider
  // tried to clear messages in updatedState.
  const containsFirst = calls[1].messages.some((m) =>
    m.role === "assistant" && m.content === "one"
  );
  assertEquals(containsFirst, true);
  assertEquals(Boolean(calls[1].state?.runId), true);
});
