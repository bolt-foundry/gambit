import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import {
  createModelAliasResolver,
  loadProjectConfig,
} from "./project_config.ts";

Deno.test("loadProjectConfig finds the nearest gambit.toml", async () => {
  const dir = await Deno.makeTempDir();
  const nested = path.join(dir, "nested", "deeper");
  await Deno.mkdir(nested, { recursive: true });
  const configPath = path.join(dir, "gambit.toml");
  await Deno.writeTextFile(
    configPath,
    `
[workspace]
decks = "decks"

[models.aliases.randall]
model = "ollama/gpt-awesome"

[models.aliases.randall.params]
temperature = 0.1
`,
  );
  const startFile = path.join(nested, "deck.deck.md");
  await Deno.writeTextFile(startFile, "Deck");
  const loaded = await loadProjectConfig(startFile);
  assert(loaded, "config should load");
  assertEquals(loaded.path, configPath);
  assertEquals(loaded.config.workspace?.decks, "decks");
  assertEquals(
    loaded.config.models?.aliases?.randall?.model,
    "ollama/gpt-awesome",
  );
  assertEquals(
    loaded.config.models?.aliases?.randall?.params?.temperature,
    0.1,
  );
});

Deno.test("createModelAliasResolver resolves aliases with params", () => {
  const resolver = createModelAliasResolver({
    models: {
      aliases: {
        randall: {
          model: "ollama/gpt-awesome",
          params: { temperature: 0.2, max_tokens: 512 },
        },
      },
    },
  });
  const resolution = resolver("randall");
  assertEquals(resolution.applied, true);
  assertEquals(resolution.alias, "randall");
  assertEquals(resolution.model, "ollama/gpt-awesome");
  assertEquals(resolution.params, { temperature: 0.2, max_tokens: 512 });
});

Deno.test("createModelAliasResolver supports array models", () => {
  const resolver = createModelAliasResolver({
    models: {
      aliases: {
        randall: {
          model: ["ollama/llama3.1", "openrouter/openai/gpt-4o-mini"],
        },
      },
    },
  });
  const resolution = resolver("randall");
  assertEquals(resolution.applied, true);
  assertEquals(resolution.model, [
    "ollama/llama3.1",
    "openrouter/openai/gpt-4o-mini",
  ]);
});

Deno.test("createModelAliasResolver flags missing aliases", () => {
  const resolver = createModelAliasResolver({
    models: {
      aliases: {
        randall: { model: "ollama/gpt-awesome" },
      },
    },
  });
  const resolution = resolver("nonexistent");
  assertEquals(resolution.applied, false);
  assertEquals(resolution.missingAlias, true);
  assertEquals(resolution.model, "nonexistent");
});
