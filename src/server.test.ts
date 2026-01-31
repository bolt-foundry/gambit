import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";

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

async function readJsonLines(filePath: string): Promise<Array<unknown>> {
  const text = await Deno.readTextFile(filePath);
  return text.split("\n").filter((line) => line.trim().length > 0).map((line) =>
    JSON.parse(line)
  );
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

Deno.test("simulator persists snapshot + events and hydrates traces", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "persist.deck.ts");
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
    sessionDir: sessionsDir,
  });

  const port = (server.addr as Deno.NetAddr).port;
  const result = await runSimulator(port, { input: "hello", stream: false });
  assert(result.sessionId, "missing sessionId");

  const sessionDir = path.join(sessionsDir, result.sessionId!);
  const statePath = path.join(sessionDir, "state.json");
  const eventsPath = path.join(sessionDir, "events.jsonl");

  const state = JSON.parse(await Deno.readTextFile(statePath)) as Record<
    string,
    unknown
  >;
  assert(!("traces" in state), "state.json should exclude traces");
  const meta = state.meta as Record<string, unknown>;
  assertEquals(meta.sessionEventsPath, eventsPath);
  assertEquals(
    meta.sessionFeedbackPath,
    path.join(sessionDir, "feedback.jsonl"),
  );
  assertEquals(meta.sessionGradingPath, path.join(sessionDir, "grading.jsonl"));

  const events = await readJsonLines(eventsPath);
  assert(events.length > 0, "events.jsonl should have entries");
  assert(
    events.some((event) =>
      (event as { type?: string }).type === "session.start"
    ),
  );
  assert(
    events.some((event) => (event as { kind?: string }).kind === "trace"),
  );

  const sessionRes = await fetch(
    `http://127.0.0.1:${port}/api/session?sessionId=${result.sessionId}`,
  );
  const sessionPayload = await sessionRes.json() as {
    traces?: Array<unknown>;
  };
  assert(Array.isArray(sessionPayload.traces));
  assert(sessionPayload.traces.length > 0, "traces should hydrate from events");

  await server.shutdown();
  await server.finished;
});

Deno.test("build bot endpoint streams status and runs", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "build-primary.deck.ts");
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
    chat(input) {
      input.onStreamText?.("h");
      input.onStreamText?.("i");
      return Promise.resolve({
        message: { role: "assistant", content: "hi" },
        finishReason: "stop",
      });
    },
  };

  const prevFlag = Deno.env.get("GAMBIT_SIMULATOR_BUILD_TAB");
  Deno.env.set("GAMBIT_SIMULATOR_BUILD_TAB", "1");
  try {
    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });
    const port = (server.addr as Deno.NetAddr).port;

    const homepage = await fetch(`http://127.0.0.1:${port}/build`);
    const html = await homepage.text();
    assert(html.includes("__GAMBIT_BUILD_TAB_ENABLED__"));

    const runId = "test-build-run";
    const res = await fetch(`http://127.0.0.1:${port}/api/build/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, message: "" }),
    });
    const body = await res.json().catch(() => ({})) as {
      run?: { id?: string; status?: string };
      error?: string;
    };
    assertEquals(res.ok, true);
    assertEquals(body.run?.id, runId);

    let status: unknown = null;
    for (let i = 0; i < 20; i += 1) {
      const sres = await fetch(
        `http://127.0.0.1:${port}/api/build/status?runId=${
          encodeURIComponent(runId)
        }`,
      );
      const sb = await sres.json().catch(() => ({})) as {
        run?: { status?: string; messages?: Array<{ content?: string }> };
      };
      status = sb.run?.status ?? null;
      if (sb.run?.status === "completed") {
        assert((sb.run.messages?.[0]?.content ?? "").length > 0);
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assertEquals(status, "completed");

    await server.shutdown();
    await server.finished;
  } finally {
    if (prevFlag === undefined) {
      Deno.env.delete("GAMBIT_SIMULATOR_BUILD_TAB");
    } else {
      Deno.env.set("GAMBIT_SIMULATOR_BUILD_TAB", prevFlag);
    }
  }
});

Deno.test("simulator appends feedback log entries", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "feedback.deck.ts");
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
    sessionDir: sessionsDir,
  });

  const port = (server.addr as Deno.NetAddr).port;
  const result = await runSimulator(port, { input: "hello", stream: false });
  assert(result.sessionId, "missing sessionId");

  const sessionDir = path.join(sessionsDir, result.sessionId!);
  const state = JSON.parse(
    await Deno.readTextFile(path.join(sessionDir, "state.json")),
  ) as { messageRefs?: Array<{ id?: string }> };
  const messageRefId = state.messageRefs?.[0]?.id;
  assert(messageRefId, "missing messageRefId");

  const res = await fetch(`http://127.0.0.1:${port}/api/simulator/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: result.sessionId,
      messageRefId,
      score: 1,
      reason: "ok",
    }),
  });
  assert(res.ok);
  await res.json();

  const feedbackPath = path.join(sessionDir, "feedback.jsonl");
  const entries = await readJsonLines(feedbackPath);
  assert(entries.length > 0, "feedback.jsonl should have entries");
  assert(
    entries.some((entry) =>
      (entry as { type?: string }).type === "feedback.update"
    ),
  );

  await server.shutdown();
  await server.finished;
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

Deno.test("simulator schema defaults honor provided context", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "context.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({
        name: z.string(),
        mode: z.enum(["a", "b"]),
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

  const initialContext = { name: "Dr. Aurora", mode: "b" } as const;

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
    initialContext,
    contextProvided: true,
  });

  const port = (server.addr as Deno.NetAddr).port;

  const schemaRes = await fetch(`http://127.0.0.1:${port}/schema`);
  const schemaBody = await schemaRes.json() as { defaults?: unknown };

  assertEquals(schemaBody.defaults, initialContext);

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
    m.tool_calls?.some((t) => t.function.name === "gambit_context")
  );
  if (!initMsg || !initMsg.tool_calls?.length) {
    throw new Error("missing gambit_context call");
  }
  const initArgs = JSON.parse(initMsg.tool_calls[0].function.arguments) as {
    input?: unknown;
    runId?: string;
  };
  assertEquals(initArgs, {});

  const initTool = calls[0].messages.find((m) =>
    m.role === "tool" && m.name === "gambit_context"
  );
  if (!initTool || !initTool.content) {
    throw new Error("missing gambit_context tool payload");
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
      import("@bolt-foundry/gambit-core").ModelMessage
    >;
    state?: import("@bolt-foundry/gambit-core").SavedState;
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
        } as unknown as import("@bolt-foundry/gambit-core").SavedState,
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
