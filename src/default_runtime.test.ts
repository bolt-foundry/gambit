import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import * as path from "@std/path";
import { existsSync } from "@std/fs";
import type { ModelProvider, ModelResolver } from "@bolt-foundry/gambit-core";
import {
  createDefaultedRuntime,
  runDeck,
  runDeckResponses,
} from "./default_runtime.ts";

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

function textProvider(
  text: string,
  onModel?: (model: string) => void,
): ModelProvider {
  return {
    responses: (input) => {
      onModel?.(input.request.model);
      return Promise.resolve({
        id: "test-response",
        object: "response",
        status: "completed",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        }],
      });
    },
  };
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
      const resolver = runtime.modelResolver.resolveModel;
      if (!resolver) {
        throw new Error(
          "Expected runtime model resolver to expose resolveModel",
        );
      }

      const codex = await resolver({ model: "codex-cli/default" });
      assertEquals(codex.model, "codex-cli/default");

      const claude = await resolver({ model: "claude-code-cli/default" });
      assertEquals(claude.model, "claude-code-cli/default");

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

      const perRunProvider = textProvider("per-run");
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
      const provider = textProvider(
        "override-ok",
        (model) => models.push(model),
      );

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
  name: "runDeckResponses wrapper returns structured output with defaults",
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
      const deckPath = await writeDeck(dir, "test/model");
      const result = await runDeckResponses({
        path: deckPath,
        input: undefined,
        inputProvided: false,
        initialUserMessage: "hello",
        modelProvider: textProvider("structured-default"),
      });
      assertEquals(result.status, "completed");
      assertEquals(result.output.length, 1);
      assertEquals(result.finishReason, "stop");
      assertStringIncludes(JSON.stringify(result.output), "structured-default");
    },
  );
});

Deno.test({
  name: "per-run model resolver is forwarded with a custom provider",
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
      const deckPath = await writeDeck(dir, "alias/model");
      let sawModel = "";
      let sawParams: Record<string, unknown> | undefined;
      const provider = textProvider("resolved", (model) => {
        sawModel = model;
      });
      const wrappedProvider: ModelProvider = {
        responses: async (input) => {
          sawParams = input.request.params;
          return await provider.responses(input);
        },
      };
      const resolver: ModelResolver = {
        resolveModel: (input) => {
          assertEquals(input.model, "alias/model");
          return Promise.resolve({
            model: "resolved/model",
            params: { temperature: 0.25 },
          });
        },
      };

      const result = await runDeckResponses({
        path: deckPath,
        input: undefined,
        inputProvided: false,
        initialUserMessage: "hello",
        modelProvider: wrappedProvider,
        modelResolver: resolver,
      });

      assertEquals(result.status, "completed");
      assertEquals(sawModel, "resolved/model");
      assertEquals(sawParams, { temperature: 0.25 });
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
  name: "default runtime does not write local state files by default",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "test/model");
  const provider = textProvider("no-artifacts");
  const runtime = await createDefaultedRuntime({ modelProvider: provider });
  await runtime.runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "hello",
  });
  assertEquals(existsSync(path.join(dir, "workspace.sqlite")), false);
});

Deno.test({
  name: "default runtime rejects removed sessionArtifacts config",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "test/model");
  const provider = textProvider("artifact-ok");
  const runtime = await createDefaultedRuntime({
    modelProvider: provider,
    sessionArtifacts: { rootDir: path.join(dir, "artifacts") },
  });

  await assertRejects(
    async () =>
      await runtime.runDeck({
        path: deckPath,
        input: undefined,
        inputProvided: false,
        initialUserMessage: "hello",
      }),
    Error,
    "sessionArtifacts persistence has been removed",
  );
});

Deno.test({
  name: "default runtime rejects per-run sessionArtifacts config",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "test/model");
  const runtime = await createDefaultedRuntime({
    modelProvider: textProvider("ok"),
  });

  await assertRejects(
    async () =>
      await runtime.runDeck({
        path: deckPath,
        input: undefined,
        inputProvided: false,
        initialUserMessage: "hello",
        sessionArtifacts: {
          rootDir: path.join(dir, "artifacts"),
          sessionId: "manual-session",
        },
      }),
    Error,
    "sessionArtifacts persistence has been removed",
  );
});
