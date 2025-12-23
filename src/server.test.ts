import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "./types.ts";

function modImportPath() {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const modPath = path.resolve(here, "..", "mod.ts");
  return path.toFileUrl(modPath).href;
}

Deno.test("websocket simulator streams responses", async () => {
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
  const messages: Array<{ type?: string; chunk?: string; result?: unknown }> =
    [];

  const homepage = await fetch(`http://127.0.0.1:${port}/`);
  const html = await homepage.text();
  if (!html.includes("Gambit WebSocket Debug")) {
    throw new Error("Debug page missing expected content");
  }

  const resultPromise = new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 2000);

      const ws = new WebSocket(`ws://127.0.0.1:${port}/websocket`);
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as {
          type?: string;
          chunk?: string;
          result?: unknown;
        };
        messages.push(msg);
        if (msg.type === "result") {
          clearTimeout(timer);
          ws.close();
          resolve(msg as Record<string, unknown>);
        }
      };
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "run", input: "hello" }));
      };
    },
  );

  const resultMsg = await resultPromise;
  await server.shutdown();
  await server.finished;

  assertEquals(resultMsg.result, "hi");
  const streams = messages.filter((m) => m.type === "stream").map((m) =>
    m.chunk ?? ""
  )
    .join("");
  assertEquals(streams, "hi");

  const types = messages.map((m) => m.type);
  assertEquals(types.includes("ready"), true);
  assertEquals(types.includes("result"), true);
});

Deno.test("websocket simulator exposes schema and defaults", async () => {
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

  const readyMsg = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 2000);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/websocket`);
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        if (msg.type === "ready") {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      };
    },
  );

  await server.shutdown();
  await server.finished;

  assertEquals(readyMsg.type, "ready");
  const schema = readyMsg.schema as {
    kind?: string;
    fields?: Record<string, { kind?: string }>;
  };
  assert(schema);
  assertEquals(schema.kind, "object");
  assertEquals(schema.fields?.name?.kind, "string");
  const defaults = readyMsg.defaults as { name?: string };
  assertEquals(defaults?.name, "CallFlow");
});

Deno.test("websocket simulator preserves state and user input", async () => {
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
    messages: Array<import("./types.ts").ModelMessage>;
    state?: import("./state.ts").SavedState;
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

  const ws = new WebSocket(`ws://127.0.0.1:${port}/websocket`);
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 4000);
    let sentFirst = false;
    let sentSecond = false;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type?: string };
      if (msg.type === "ready" && !sentFirst) {
        sentFirst = true;
        ws.send(
          JSON.stringify({
            type: "run",
            input: "hello",
            message: "hello",
          }),
        );
        return;
      }
      if (msg.type === "result" && sentFirst && !sentSecond) {
        sentSecond = true;
        ws.send(
          JSON.stringify({
            type: "run",
            input: "again",
            message: "again",
          }),
        );
        return;
      }
      if (msg.type === "result" && sentSecond) {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("ws error"));
    };
  });

  await done;
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

Deno.test("websocket simulator treats follow-up input as a user message when state exists", async () => {
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
    messages: Array<import("./types.ts").ModelMessage>;
    state?: import("./state.ts").SavedState;
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

  const ws = new WebSocket(`ws://127.0.0.1:${port}/websocket`);
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 4000);
    let sentFirst = false;
    let sentSecond = false;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type?: string };
      if (msg.type === "ready" && !sentFirst) {
        sentFirst = true;
        ws.send(JSON.stringify({ type: "run", input: "context" }));
        return;
      }
      if (msg.type === "result" && sentFirst && !sentSecond) {
        sentSecond = true;
        ws.send(JSON.stringify({ type: "run", input: "follow-up" }));
        return;
      }
      if (msg.type === "result" && sentSecond) {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("ws error"));
    };
  });

  await done;
  await server.shutdown();
  await server.finished;

  assertEquals(calls.length, 2);
  const secondLastUser = [...calls[1].messages].reverse().find((m) =>
    m.role === "user"
  );
  assertEquals(secondLastUser?.content, "follow-up");
});

Deno.test("websocket simulator emits state updates for download", async () => {
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
  const ws = new WebSocket(`ws://127.0.0.1:${port}/websocket`);

  const done = new Promise<import("./state.ts").SavedState>(
    (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 4000);
      let captured: import("./state.ts").SavedState | undefined;
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as {
          type?: string;
          state?: unknown;
        };
        if (msg.type === "ready") {
          ws.send(JSON.stringify({ type: "run", input: "save-me" }));
          return;
        }
        if (msg.type === "state") {
          captured = msg.state as import("./state.ts").SavedState;
          return;
        }
        if (msg.type === "result") {
          clearTimeout(timer);
          ws.close();
          if (captured) {
            resolve(captured);
          } else {
            reject(new Error("missing state message"));
          }
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      };
    },
  );

  const state = await done;
  await server.shutdown();
  await server.finished;

  assert(state.messages.length > 0);
  assertEquals(state.meta?.note, "saved");
  assert(Boolean(state.runId));
});

Deno.test("websocket simulator falls back when provider state lacks messages", async () => {
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
    messages: Array<import("./types.ts").ModelMessage>;
    state?: import("./state.ts").SavedState;
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
        } as unknown as import("./state.ts").SavedState,
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  const port = (server.addr as Deno.NetAddr).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/websocket`);
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 4000);
    let sentFirst = false;
    let sentSecond = false;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type?: string };
      if (msg.type === "ready" && !sentFirst) {
        sentFirst = true;
        ws.send(JSON.stringify({
          type: "run",
          input: "one",
          message: "one",
        }));
        return;
      }
      if (msg.type === "result" && sentFirst && !sentSecond) {
        sentSecond = true;
        ws.send(JSON.stringify({
          type: "run",
          input: "two",
          message: "two",
        }));
        return;
      }
      if (msg.type === "result" && sentSecond) {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("ws error"));
    };
  });

  await done;
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
