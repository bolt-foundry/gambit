import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import {
  modImportPath,
  readJsonLines,
  readStreamEvents,
  runSimulator,
} from "./server_test_utils.ts";

Deno.test("build bot rejects roots that overlap Gambit Bot source directory", async () => {
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
    chat() {
      return Promise.resolve({
        message: { role: "assistant", content: "hi" },
        finishReason: "stop",
      });
    },
  };

  const previous = Deno.env.get("GAMBIT_SIMULATOR_BUILD_BOT_ROOT");
  const unsafeRoot = path.resolve(
    path.dirname(path.fromFileUrl(import.meta.url)),
    "decks",
    "gambit-bot",
  );
  Deno.env.set("GAMBIT_SIMULATOR_BUILD_BOT_ROOT", unsafeRoot);

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });
  try {
    const port = (server.addr as Deno.NetAddr).port;
    const runId = "unsafe-root-run";
    const res = await fetch(`http://127.0.0.1:${port}/api/build/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, message: "" }),
    });
    const body = await res.json().catch(() => ({})) as { error?: string };
    assertEquals(res.status, 400);
    assertEquals(
      typeof body.error === "string" &&
        body.error.includes("Unsafe build bot root"),
      true,
    );
  } finally {
    await server.shutdown();
    await server.finished;
    if (previous === undefined) {
      Deno.env.delete("GAMBIT_SIMULATOR_BUILD_BOT_ROOT");
    } else {
      Deno.env.set("GAMBIT_SIMULATOR_BUILD_BOT_ROOT", previous);
    }
  }
});

Deno.test("build API errors are persisted to session errors sidecar", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "build-errors.deck.ts");
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

  const workspaceRes = await fetch(
    `http://127.0.0.1:${port}/api/workspace/new`,
    {
      method: "POST",
    },
  );
  assertEquals(workspaceRes.ok, true);
  const workspaceBody = await workspaceRes.json() as { workspaceId?: string };
  const workspaceId = workspaceBody.workspaceId ?? "";
  assert(workspaceId.length > 0, "missing workspaceId");

  const missingPathRes = await fetch(
    `http://127.0.0.1:${port}/api/build/file?workspaceId=${
      encodeURIComponent(workspaceId)
    }`,
  );
  assertEquals(missingPathRes.status, 400);
  await missingPathRes.text();

  const errorsPath = path.join(sessionsDir, workspaceId, "events.jsonl");
  const errors = await readJsonLines(errorsPath);
  assert(errors.length > 0, "events.jsonl should have entries");
  const hasBuildFileMissingPath = errors.some((entry) => {
    const row = entry as {
      type?: string;
      endpoint?: string;
      status?: number;
      message?: string;
    };
    return row.type === "gambit.server.error" &&
      row.endpoint === "/api/build/file" &&
      row.status === 400 &&
      row.message === "Missing path";
  });
  assert(hasBuildFileMissingPath);

  await server.shutdown();
  await server.finished;
});

Deno.test("build files API excludes .gambit directory entries", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "build-files.deck.ts");
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

  const workspaceRes = await fetch(
    `http://127.0.0.1:${port}/api/workspace/new`,
    { method: "POST" },
  );
  assertEquals(workspaceRes.ok, true);
  const workspaceBody = await workspaceRes.json() as { workspaceId?: string };
  const workspaceId = workspaceBody.workspaceId ?? "";
  assert(workspaceId.length > 0, "missing workspaceId");

  const filesRes = await fetch(
    `http://127.0.0.1:${port}/api/build/files?workspaceId=${
      encodeURIComponent(workspaceId)
    }`,
  );
  assertEquals(filesRes.ok, true);
  const filesBody = await filesRes.json() as {
    root?: string;
    entries?: Array<{ path?: string }>;
  };
  const root = filesBody.root ?? "";
  assert(root.length > 0, "missing bot root");

  await Deno.mkdir(path.join(root, ".gambit", "nested"), { recursive: true });
  await Deno.writeTextFile(path.join(root, ".gambit", "hidden.txt"), "secret");
  await Deno.writeTextFile(
    path.join(root, ".gambit", "nested", "also-hidden.txt"),
    "secret",
  );
  await Deno.writeTextFile(path.join(root, "visible.txt"), "visible");
  await Deno.mkdir(path.join(root, "scenarios", "scenario_a"), {
    recursive: true,
  });
  await Deno.writeTextFile(
    path.join(root, "scenarios", "scenario_a", "PROMPT.md"),
    `+++
label = "Scenario Alpha"
+++

Body
`,
  );

  const refreshedRes = await fetch(
    `http://127.0.0.1:${port}/api/build/files?workspaceId=${
      encodeURIComponent(workspaceId)
    }`,
  );
  assertEquals(refreshedRes.ok, true);
  const refreshedBody = await refreshedRes.json() as {
    entries?: Array<{ path?: string; label?: string }>;
  };
  const paths = (refreshedBody.entries ?? [])
    .map((entry) => entry.path ?? "")
    .filter((value) => value.length > 0);

  assertEquals(paths.includes("visible.txt"), true);
  assertEquals(
    paths.some((value) => value === ".gambit" || value.startsWith(".gambit/")),
    false,
  );
  const scenarioPrompt = (refreshedBody.entries ?? []).find((entry) =>
    entry.path === "scenarios/scenario_a/PROMPT.md"
  );
  assertEquals(scenarioPrompt?.label, "Scenario Alpha");

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
    workspaceId: first.workspaceId,
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
    workspaceId: first.workspaceId,
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
    workspaceId: first.workspaceId,
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
