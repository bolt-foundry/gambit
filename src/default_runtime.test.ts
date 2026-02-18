import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import * as path from "@std/path";
import { existsSync } from "@std/fs";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import { createDefaultedRuntime, runDeck } from "./default_runtime.ts";

type EnvPatch = Record<string, string | undefined>;

async function withEnv(
  patch: EnvPatch,
  run: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

async function writeDeck(
  dir: string,
  model: string,
  body = "Return a short answer.",
): Promise<string> {
  const deckPath = path.join(dir, "root.deck.md");
  const contents = `+++
label = "runtime test"

[modelParams]
model = "${model}"
+++

${body}
`;
  await Deno.writeTextFile(deckPath, contents);
  return deckPath;
}

async function readJsonLines(filePath: string): Promise<Array<unknown>> {
  const text = await Deno.readTextFile(filePath);
  return text.split("\n").filter((line) => line.trim()).map((line) =>
    JSON.parse(line)
  );
}

async function listSessionDirs(root: string): Promise<Array<string>> {
  const dirs: Array<string> = [];
  if (!existsSync(root)) return dirs;
  for await (const entry of Deno.readDir(root)) {
    if (entry.isDirectory) dirs.push(path.join(root, entry.name));
  }
  dirs.sort();
  return dirs;
}

Deno.test({
  name:
    "default runtime provider resolves codex-cli and prefixed/fallback providers like CLI",
  permissions: { env: true },
}, async () => {
  await withEnv(
    {
      OPENROUTER_API_KEY: "test-openrouter-key",
      GOOGLE_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      OLLAMA_API_KEY: undefined,
    },
    async () => {
      const runtime = await createDefaultedRuntime();
      const resolver = runtime.modelProvider.resolveModel;
      if (!resolver) {
        throw new Error(
          "Expected runtime model provider to expose resolveModel",
        );
      }

      const codex = await resolver({ model: "codex-cli/default" });
      assertEquals(codex.model, "codex-cli/default");

      const prefixed = await resolver({ model: "openrouter/openai/gpt-5.1" });
      assertEquals(prefixed.model, "openrouter/openai/gpt-5.1");

      const googleFallback = await resolver({ model: "google/gemini-2.5-pro" });
      assertEquals(googleFallback.model, "google/gemini-2.5-pro");
    },
  );
});

Deno.test({
  name: "default runtime precedence favors runtime and per-run overrides",
  permissions: { read: true, write: true, env: true },
}, async () => {
  await withEnv(
    {
      GAMBIT_RESPONSES_MODE: "0",
      GAMBIT_CHAT_FALLBACK: "0",
      OPENROUTER_API_KEY: "test-openrouter-key",
    },
    async () => {
      const dir = await Deno.makeTempDir();
      await Deno.writeTextFile(
        path.join(dir, "gambit.toml"),
        `[providers]\nfallback = "codex-cli"\n`,
      );

      const runtimeFromProject = await createDefaultedRuntime({
        configHint: dir,
      });
      assertEquals(runtimeFromProject.configuredFallbackProvider, "codex-cli");
      assertEquals(runtimeFromProject.responsesMode, false);

      const runtimeOverride = await createDefaultedRuntime({
        configHint: dir,
        fallbackProvider: null,
        defaultModel: "runtime/default",
        modelOverride: "runtime/force",
        responsesMode: true,
      });
      assertEquals(runtimeOverride.configuredFallbackProvider, null);
      assertEquals(runtimeOverride.responsesMode, true);

      const perRunProvider: ModelProvider = {
        chat: () =>
          Promise.resolve({
            message: { role: "assistant", content: "per-run" },
            finishReason: "stop",
          }),
      };
      const resolved = runtimeOverride.resolveRunOptions({
        path: path.join(dir, "unused.deck.md"),
        input: undefined,
        modelProvider: perRunProvider,
        defaultModel: "per-run/default",
        modelOverride: "per-run/force",
        responsesMode: false,
      });
      assertEquals(resolved.modelProvider, perRunProvider);
      assertEquals(resolved.defaultModel, "per-run/default");
      assertEquals(resolved.modelOverride, "per-run/force");
      assertEquals(resolved.responsesMode, false);
    },
  );
});

Deno.test({
  name:
    "runDeck wrapper preserves direct provider usage when explicitly passed",
  permissions: { read: true, write: true, env: true },
}, async () => {
  await withEnv(
    {
      OPENROUTER_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
    },
    async () => {
      const dir = await Deno.makeTempDir();
      const deckPath = await writeDeck(
        dir,
        "openrouter/openai/gpt-5.1-chat",
        "Reply with one word.",
      );
      const models: Array<string> = [];
      const provider: ModelProvider = {
        chat: (input) => {
          models.push(input.model);
          return Promise.resolve({
            message: { role: "assistant", content: "override-ok" },
            finishReason: "stop",
          });
        },
      };

      const output = await runDeck({
        path: deckPath,
        input: undefined,
        inputProvided: false,
        initialUserMessage: "hello",
        modelProvider: provider,
      });
      assertEquals(models, ["openrouter/openai/gpt-5.1-chat"]);
      const text = typeof output === "string" ? output : JSON.stringify(output);
      assertStringIncludes(text, "override-ok");
    },
  );
});

Deno.test({
  name: "runDeck wrapper rejects runtime + runtimeOptions ambiguity",
  permissions: { env: true },
}, async () => {
  const runtime = await createDefaultedRuntime();
  await assertRejects(
    async () =>
      await runDeck({
        path: "unused.deck.md",
        input: undefined,
        runtime,
        runtimeOptions: {},
      }),
    Error,
    "runDeck received both runtime and runtimeOptions",
  );
});

Deno.test({
  name: "default runtime does not write session artifacts unless opted in",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "test/model");
  const provider: ModelProvider = {
    chat: () =>
      Promise.resolve({
        message: { role: "assistant", content: "no-artifacts" },
        finishReason: "stop",
      }),
  };
  const runtime = await createDefaultedRuntime({ modelProvider: provider });
  await runtime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "hello",
  });
  assertEquals(existsSync(path.join(dir, "state.json")), false);
  assertEquals(existsSync(path.join(dir, "events.jsonl")), false);
});

Deno.test({
  name: "default runtime writes state.json and events.jsonl when opted in",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const artifactsRoot = path.join(dir, "artifacts");
  const deckPath = await writeDeck(dir, "test/model");
  const provider: ModelProvider = {
    chat: () =>
      Promise.resolve({
        message: { role: "assistant", content: "artifact-ok" },
        finishReason: "stop",
      }),
  };
  const runtime = await createDefaultedRuntime({
    modelProvider: provider,
    sessionArtifacts: { rootDir: artifactsRoot },
  });
  await runtime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "hello",
  });

  const dirs = await listSessionDirs(artifactsRoot);
  assertEquals(dirs.length, 1);
  const sessionDir = dirs[0];
  const statePath = path.join(sessionDir, "state.json");
  const eventsPath = path.join(sessionDir, "events.jsonl");
  assertEquals(existsSync(statePath), true);
  assertEquals(existsSync(eventsPath), true);

  const events = await readJsonLines(eventsPath) as Array<{ offset?: number }>;
  assert(events.length > 0, "expected persisted trace events");
  assert(
    events.some((entry) =>
      (entry as { type?: string }).type === "gambit.run.start"
    ),
    "expected non-OpenResponses trace events to be gambit.* namespaced",
  );
  const offsets = events.map((entry) => entry.offset).filter((
    value,
  ): value is number => typeof value === "number");
  for (let i = 1; i < offsets.length; i += 1) {
    assertEquals(offsets[i], offsets[i - 1] + 1);
  }
  const state = JSON.parse(await Deno.readTextFile(statePath)) as {
    meta?: { lastAppliedOffset?: number };
  };
  const maxOffset = Math.max(...offsets);
  assert(typeof state.meta?.lastAppliedOffset === "number");
  assert((state.meta?.lastAppliedOffset ?? -1) <= maxOffset);
});

Deno.test({
  name:
    "default runtime persists response stream events as top-level response.* records",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const artifactsRoot = path.join(dir, "artifacts");
  const deckPath = await writeDeck(dir, "test/model");
  const provider: ModelProvider = {
    responses: ({ onStreamEvent }) => {
      onStreamEvent?.({
        type: "response.created",
        response: {
          id: "resp_1",
          object: "response",
          status: "in_progress",
          output: [],
        },
      });
      onStreamEvent?.({
        type: "response.output_text.delta",
        output_index: 0,
        delta: "hello",
      });
      onStreamEvent?.({
        type: "response.completed",
        response: {
          id: "resp_1",
          object: "response",
          status: "completed",
          output: [{
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hello" }],
          }],
        },
      });
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
    chat: () =>
      Promise.resolve({
        message: { role: "assistant", content: "unused" },
        finishReason: "stop",
      }),
  };
  const runtime = await createDefaultedRuntime({
    modelProvider: provider,
    responsesMode: true,
    sessionArtifacts: { rootDir: artifactsRoot },
  });
  await runtime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "hello",
    stream: true,
  });

  const dirs = await listSessionDirs(artifactsRoot);
  assertEquals(dirs.length, 1);
  const eventsPath = path.join(dirs[0], "events.jsonl");
  const events = await readJsonLines(eventsPath) as Array<
    { type?: string; event?: { type?: string } }
  >;
  assert(events.some((event) => event.type === "response.created"));
  assert(events.some((event) => event.type === "response.completed"));
  assertEquals(
    events.some((event) =>
      event.type === "model.stream.event" &&
      event.event?.type === "response.created"
    ),
    false,
  );
});

Deno.test({
  name: "default runtime supports loading snapshot and continuing a session",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const artifactsRoot = path.join(dir, "artifacts");
  const deckPath = await writeDeck(dir, "test/model");
  const observedMessageCounts: Array<number> = [];
  const provider: ModelProvider = {
    chat: (input) => {
      observedMessageCounts.push(input.messages.length);
      return Promise.resolve({
        message: { role: "assistant", content: "resume-ok" },
        finishReason: "stop",
      });
    },
  };
  const runtime = await createDefaultedRuntime({ modelProvider: provider });
  const sessionArtifacts = {
    rootDir: artifactsRoot,
    sessionId: "resume-session",
    continueSession: true,
  } as const;

  await runtime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "first",
    sessionArtifacts,
  });
  const statePath = path.join(
    artifactsRoot,
    "resume-session",
    "state.json",
  );
  const firstState = JSON.parse(await Deno.readTextFile(statePath)) as {
    messages?: Array<unknown>;
  };
  const firstMessageCount = firstState.messages?.length ?? 0;
  assert(firstMessageCount > 0, "first run should persist messages");

  await runtime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "second",
    sessionArtifacts,
  });
  const secondState = JSON.parse(await Deno.readTextFile(statePath)) as {
    messages?: Array<unknown>;
    meta?: { lastAppliedOffset?: number };
  };
  assert(
    (secondState.messages?.length ?? 0) > firstMessageCount,
    "continued run should grow persisted transcript",
  );
  assert(observedMessageCounts.length >= 2, "expected two provider calls");
  assert(
    observedMessageCounts[1] > observedMessageCounts[0],
    "continued run should provide larger history to model",
  );

  const events = await readJsonLines(
    path.join(artifactsRoot, "resume-session", "events.jsonl"),
  ) as Array<{ offset?: number }>;
  const offsets = events.map((entry) => entry.offset).filter((
    value,
  ): value is number => typeof value === "number");
  assert(offsets.length > 0, "expected persisted events after continuation");
  for (let i = 1; i < offsets.length; i += 1) {
    assertEquals(offsets[i], offsets[i - 1] + 1);
  }
  const maxOffset = Math.max(...offsets);
  assert(typeof secondState.meta?.lastAppliedOffset === "number");
  assert((secondState.meta?.lastAppliedOffset ?? -1) <= maxOffset);
});

Deno.test({
  name: "default runtime rejects concurrent writers for same artifact session",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const artifactsRoot = path.join(dir, "artifacts");
  const deckPath = await writeDeck(dir, "test/model");

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider: ModelProvider = {
    chat: async () => {
      await gate;
      return {
        message: { role: "assistant", content: "slow" },
        finishReason: "stop",
      };
    },
  };
  const runtime = await createDefaultedRuntime({ modelProvider: provider });
  const runOpts = {
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "hello",
    sessionArtifacts: {
      rootDir: artifactsRoot,
      sessionId: "shared-session",
      continueSession: true,
    },
  } as const;

  const first = runtime.runDeck(runOpts);
  await assertRejects(
    async () => await runtime.runDeck(runOpts),
    Error,
    "already active",
  );
  release();
  await first;
});

Deno.test({
  name: "default runtime creates isolated artifact sessions by default",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const artifactsRoot = path.join(dir, "artifacts");
  const deckPath = await writeDeck(dir, "test/model");
  const provider: ModelProvider = {
    chat: () =>
      Promise.resolve({
        message: { role: "assistant", content: "isolated" },
        finishReason: "stop",
      }),
  };
  const runtime = await createDefaultedRuntime({
    modelProvider: provider,
    sessionArtifacts: { rootDir: artifactsRoot },
  });

  await runtime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "first",
  });
  await runtime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "second",
  });

  const dirs = await listSessionDirs(artifactsRoot);
  assertEquals(dirs.length, 2);
  assertEquals(dirs[0] === dirs[1], false);

  const isolatedRuntime = await createDefaultedRuntime({
    modelProvider: provider,
  });
  await isolatedRuntime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "one",
    sessionArtifacts: {
      rootDir: artifactsRoot,
      sessionId: "manual-session",
    },
  });
  await assertRejects(
    async () =>
      await isolatedRuntime.runDeck({
        path: deckPath,
        input: undefined,
        inputProvided: false,
        initialUserMessage: "two",
        sessionArtifacts: {
          rootDir: artifactsRoot,
          sessionId: "manual-session",
        },
      }),
    Error,
    "continueSession: true",
  );
});

Deno.test({
  name:
    "default runtime keeps snapshot boundary unchanged when traces append before failure",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const artifactsRoot = path.join(dir, "artifacts");
  const deckPath = await writeDeck(dir, "test/model");
  const sessionArtifacts = {
    rootDir: artifactsRoot,
    sessionId: "boundary-session",
    continueSession: true,
  } as const;

  const okRuntime = await createDefaultedRuntime({
    modelProvider: {
      chat: () =>
        Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        }),
    },
  });
  await okRuntime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "first",
    sessionArtifacts,
  });

  const sessionDir = path.join(artifactsRoot, sessionArtifacts.sessionId);
  const statePath = path.join(sessionDir, "state.json");
  const eventsPath = path.join(sessionDir, "events.jsonl");
  const before = JSON.parse(await Deno.readTextFile(statePath)) as {
    meta?: { lastAppliedOffset?: number };
  };
  const baselineOffset = before.meta?.lastAppliedOffset ?? -1;

  const failingRuntime = await createDefaultedRuntime({
    modelProvider: {
      chat: () => Promise.reject(new Error("model failure")),
    },
  });
  await assertRejects(
    async () =>
      await failingRuntime.runDeck({
        path: deckPath,
        input: undefined,
        inputProvided: false,
        initialUserMessage: "second",
        sessionArtifacts,
      }),
    Error,
    "model failure",
  );

  const after = JSON.parse(await Deno.readTextFile(statePath)) as {
    meta?: { lastAppliedOffset?: number };
  };
  assertEquals(after.meta?.lastAppliedOffset, baselineOffset);

  const events = await readJsonLines(eventsPath) as Array<{ offset?: number }>;
  const offsets = events.map((entry) => entry.offset).filter((
    value,
  ): value is number => typeof value === "number");
  assert(offsets.length > 0, "expected persisted events");
  assert(Math.max(...offsets) > baselineOffset, "expected new failure traces");
});

Deno.test({
  name:
    "default runtime rejects non-continue reuse when session has events without state",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const artifactsRoot = path.join(dir, "artifacts");
  const sessionDir = path.join(artifactsRoot, "events-only-session");
  await Deno.mkdir(sessionDir, { recursive: true });
  await Deno.writeTextFile(
    path.join(sessionDir, "events.jsonl"),
    `${
      JSON.stringify({
        offset: 0,
        createdAt: new Date().toISOString(),
        type: "run.start",
        runId: "x",
        timestamp: Date.now(),
        _gambit: { domain: "session", offset: 0 },
      })
    }\n`,
  );

  const deckPath = await writeDeck(dir, "test/model");
  const runtime = await createDefaultedRuntime({
    modelProvider: {
      chat: () =>
        Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        }),
    },
  });

  await assertRejects(
    async () =>
      await runtime.runDeck({
        path: deckPath,
        input: undefined,
        inputProvided: false,
        initialUserMessage: "hello",
        sessionArtifacts: {
          rootDir: artifactsRoot,
          sessionId: "events-only-session",
        },
      }),
    Error,
    "continueSession: true",
  );
});

Deno.test({
  name:
    "default runtime recovers continueSession when events exist but snapshot is missing",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const artifactsRoot = path.join(dir, "artifacts");
  const sessionDir = path.join(artifactsRoot, "events-only-continue");
  await Deno.mkdir(sessionDir, { recursive: true });
  await Deno.writeTextFile(
    path.join(sessionDir, "events.jsonl"),
    `${
      JSON.stringify({
        offset: 0,
        createdAt: new Date().toISOString(),
        type: "run.start",
        runId: "x",
        timestamp: Date.now(),
        _gambit: { domain: "session", offset: 0 },
      })
    }\n`,
  );

  const deckPath = await writeDeck(dir, "test/model");
  const runtime = await createDefaultedRuntime({
    modelProvider: {
      chat: () =>
        Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        }),
    },
  });

  await runtime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "hello",
    sessionArtifacts: {
      rootDir: artifactsRoot,
      sessionId: "events-only-continue",
      continueSession: true,
    },
  });

  const archived: Array<Deno.DirEntry> = [];
  for await (const entry of Deno.readDir(sessionDir)) {
    if (
      entry.isFile && entry.name.startsWith("events.orphaned.") &&
      entry.name.endsWith(".jsonl")
    ) {
      archived.push(entry);
    }
  }
  assertEquals(archived.length, 1);

  const events = await readJsonLines(
    path.join(sessionDir, "events.jsonl"),
  ) as Array<{ offset?: number }>;
  const offsets = events.map((entry) => entry.offset).filter((
    value,
  ): value is number => typeof value === "number");
  assert(offsets.length > 0, "expected new events for recovered continuation");
  assertEquals(offsets[0], 0);
});
