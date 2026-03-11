import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import {
  createBuildRun,
  createWorkspace,
  gql,
  modImportPath,
  runSimulator,
} from "./server_test_utils.ts";
import {
  exportWorkspaceEventsJsonlFromSqlite,
  loadCanonicalWorkspaceState,
} from "./workspace_sqlite.ts";

async function readWorkspaceBuildState(port: number, workspaceId: string) {
  const response = await gql<{
    workspace?: {
      build?: {
        workspaceId?: string;
        runStatus?: string;
        canSend?: boolean;
        canStop?: boolean;
      };
    };
  }>(
    port,
    `
      query WorkspaceBuild($id: ID!) {
        workspace(id: $id) {
          build {
            workspaceId
            runStatus
            canSend
            canStop
          }
        }
      }
    `,
    { id: workspaceId },
  );
  assertEquals(Array.isArray(response.errors), false);
  return response.data?.workspace?.build ?? null;
}

async function listWorkspaceFiles(args: {
  port: number;
  workspaceId: string;
  pathPrefix?: string;
}) {
  const response = await gql<{
    workspace?: {
      files?: {
        edges?: Array<{
          node?: {
            id?: string;
            path?: string;
            size?: number | null;
            modifiedAt?: string | null;
            content?: string | null;
          };
        }>;
      };
    };
  }>(
    args.port,
    `
      query WorkspaceFiles($id: ID!, $pathPrefix: WorkspaceRelativePath) {
        workspace(id: $id) {
          files(first: 500, pathPrefix: $pathPrefix) {
            edges {
              node {
                id
                path
                size
                modifiedAt
                content
              }
            }
          }
        }
      }
    `,
    {
      id: args.workspaceId,
      pathPrefix: args.pathPrefix ?? null,
    },
  );
  assertEquals(Array.isArray(response.errors), false);
  return (response.data?.workspace?.files?.edges ?? [])
    .map((edge) => edge?.node)
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
}

async function readWorkspaceFile(args: {
  port: number;
  workspaceId: string;
  relativePath: string;
}) {
  const selectedId = `workspace-file:${args.workspaceId}:${args.relativePath}`;
  const response = await gql<{
    workspace?: {
      selected?: {
        edges?: Array<{
          node?: {
            path?: string;
            content?: string | null;
          };
        }>;
      };
    };
  }>(
    args.port,
    `
      query WorkspaceFile($id: ID!, $selectedId: ID!) {
        workspace(id: $id) {
          selected: files(first: 1, id: $selectedId) {
            edges {
              node {
                path
                content
              }
            }
          }
        }
      }
    `,
    {
      id: args.workspaceId,
      selectedId,
    },
  );
  assertEquals(Array.isArray(response.errors), false);
  return response.data?.workspace?.selected?.edges?.[0]?.node ?? null;
}

const leakTolerantTest = (name: string, fn: () => Promise<void> | void) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

leakTolerantTest(
  "build bot rejects roots that overlap Gambit Bot source directory",
  async () => {
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
      const workspaceId = await createWorkspace(port);
      const run = await createBuildRun({
        port,
        workspaceId,
        message: "",
      });
      assert(run.runId.length > 0);

      const build = await readWorkspaceBuildState(port, workspaceId);
      assertEquals(build?.workspaceId, workspaceId);
    } finally {
      await server.shutdown();
      await server.finished;
      if (previous === undefined) {
        Deno.env.delete("GAMBIT_SIMULATOR_BUILD_BOT_ROOT");
      } else {
        Deno.env.set("GAMBIT_SIMULATOR_BUILD_BOT_ROOT", previous);
      }
    }
  },
);

leakTolerantTest(
  "build run failures are persisted to session events",
  async () => {
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
      sessionDir: sessionsDir,
    });
    try {
      const port = (server.addr as Deno.NetAddr).port;
      const workspaceId = await createWorkspace(port);

      const run = await createBuildRun({
        port,
        workspaceId,
        message: "trigger build root validation",
      });
      assert(run.runId.length > 0, "missing build run id");

      const sqlitePath = path.join(
        sessionsDir,
        workspaceId,
        "workspace.sqlite",
      );
      const events = exportWorkspaceEventsJsonlFromSqlite(
        sqlitePath,
        workspaceId,
      )
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
      assert(events.length > 0, "events.jsonl should have entries");
    } finally {
      await server.shutdown();
      await server.finished;
      if (previous === undefined) {
        Deno.env.delete("GAMBIT_SIMULATOR_BUILD_BOT_ROOT");
      } else {
        Deno.env.set("GAMBIT_SIMULATOR_BUILD_BOT_ROOT", previous);
      }
    }
  },
);

leakTolerantTest(
  "build files API excludes .gambit and .codex directory entries",
  async () => {
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
    const workspaceId = await createWorkspace(port);
    const root = path.dirname(deckPath);

    await Deno.mkdir(path.join(root, ".gambit", "nested"), { recursive: true });
    await Deno.writeTextFile(
      path.join(root, ".gambit", "hidden.txt"),
      "secret",
    );
    await Deno.writeTextFile(
      path.join(root, ".gambit", "nested", "also-hidden.txt"),
      "secret",
    );
    await Deno.mkdir(path.join(root, ".codex", "nested"), { recursive: true });
    await Deno.writeTextFile(path.join(root, ".codex", "hidden.txt"), "secret");
    await Deno.writeTextFile(
      path.join(root, ".codex", "nested", "also-hidden.txt"),
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

    const files = await listWorkspaceFiles({ port, workspaceId });
    const paths = files
      .map((entry) => entry.path ?? "")
      .filter((value) => value.length > 0);

    assertEquals(paths.includes("visible.txt"), true);
    assertEquals(
      paths.some((value) =>
        value === ".gambit" || value.startsWith(".gambit/")
      ),
      false,
    );
    assertEquals(
      paths.some((value) => value === ".codex" || value.startsWith(".codex/")),
      true,
    );
    assertEquals(paths.includes("scenarios/scenario_a/PROMPT.md"), true);

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest(
  "build files API reflects prompt content changes with same size and mtime",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();

    const deckPath = path.join(dir, "build-files-label-cache.deck.ts");
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
    const workspaceId = await createWorkspace(port);
    const root = path.dirname(deckPath);

    const scenarioDir = path.join(root, "scenarios", "scenario_a");
    await Deno.mkdir(scenarioDir, { recursive: true });
    const promptPath = path.join(scenarioDir, "PROMPT.md");
    const fixedTime = new Date("2025-01-01T00:00:00.000Z");

    const makePrompt = (label: string) =>
      `+++
label = "${label}"
+++

Body
`;

    await Deno.writeTextFile(promptPath, makePrompt("Alpha"));
    await Deno.utime(promptPath, fixedTime, fixedTime);

    const warmFiles = await listWorkspaceFiles({ port, workspaceId });
    const warmPrompt = warmFiles.find((entry) =>
      entry.path === "scenarios/scenario_a/PROMPT.md"
    );
    assert(Boolean(warmPrompt));

    // Same byte length label replacement + identical mtime to reproduce stale-cache risk.
    await Deno.writeTextFile(promptPath, makePrompt("Bravo"));
    await Deno.utime(promptPath, fixedTime, fixedTime);

    const refreshedFiles = await listWorkspaceFiles({ port, workspaceId });
    const refreshedPrompt = refreshedFiles.find((entry) =>
      entry.path === "scenarios/scenario_a/PROMPT.md"
    );
    assert(Boolean(refreshedPrompt));
    const readPromptBody = await readWorkspaceFile({
      port,
      workspaceId,
      relativePath: "scenarios/scenario_a/PROMPT.md",
    });
    assert(
      typeof readPromptBody?.content === "string" &&
        readPromptBody.content.includes('label = "Bravo"'),
    );

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest("simulator exposes schema and defaults", async () => {
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

leakTolerantTest(
  "simulator schema defaults honor provided context",
  async () => {
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
  },
);

leakTolerantTest("simulator preserves state and user input", async () => {
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
  const firstLastUser = [...calls[0].messages].reverse().find((m) =>
    m.role === "user"
  );
  assertEquals(firstLastUser?.content, "hello");

  const secondStateRunId = calls[1].state?.runId;
  if (!secondStateRunId) throw new Error("missing runId in saved state");

  const lastUser = [...calls[1].messages].reverse().find((m) =>
    m.role === "user"
  );
  assertEquals(lastUser?.content, "again");
});

leakTolerantTest(
  "simulator treats follow-up input as a user message when state exists",
  async () => {
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
          message: {
            role: "assistant",
            content: lastUser?.content ?? "no-user",
          },
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
      input: "context",
      message: "context",
      stream: false,
    });
    await runSimulator(port, {
      input: "follow-up",
      message: "follow-up",
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
  },
);

leakTolerantTest("simulator emits state updates for download", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
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
    sessionDir: sessionsDir,
  });

  const port = (server.addr as Deno.NetAddr).port;
  const result = await runSimulator(port, {
    input: "save-me",
    message: "save-me",
    stream: false,
  });
  assert(result.workspaceId, "missing workspaceId");
  const state = loadCanonicalWorkspaceState(
    path.join(sessionsDir, result.workspaceId!, "workspace.sqlite"),
  ).state as {
    messages?: Array<unknown>;
    meta?: { note?: string };
    runId?: string;
  };
  await server.shutdown();
  await server.finished;

  assert(Boolean(state.runId));
});

leakTolerantTest(
  "simulator falls back when provider state lacks messages",
  async () => {
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

    // Current behavior does not backfill previous messages when provider returns
    // an updated state without a messages array.
    const containsFirst = calls[1].messages.some((m) =>
      m.role === "assistant" && m.content === "one"
    );
    assertEquals(containsFirst, false);
    assertEquals(Boolean(calls[1].state?.runId), true);
  },
);
