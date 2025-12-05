// E2E tests that hit OpenRouter. These are ignored unless OPENROUTER_API_KEY is set
// and you explicitly target this file (pattern *.test.e2e.ts is not picked up by
// default deno test globs).
import { assert, assertStringIncludes } from "@std/assert";
import * as path from "@std/path";
import { runDeck } from "../src/runtime.ts";
import { createOpenRouterProvider } from "../src/providers/openrouter.ts";

const apiKey = Deno.env.get("OPENROUTER_API_KEY");
const baseURL = Deno.env.get("OPENROUTER_BASE_URL");
const model = Deno.env.get("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini";

const provider = apiKey
  ? createOpenRouterProvider({
    apiKey,
    baseURL,
    referer: "https://github.com/bolt-foundry/gambit",
    title: "Gambit E2E Tests",
  })
  : null;

Deno.test({
  name: "[e2e] hello_world root deck completes via echo action",
  ignore: !provider,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const deckPath = path.resolve("examples/hello_world/root.deck.ts");
    const result = await runDeck({
      path: deckPath,
      input: "hi",
      modelProvider: provider!,
      isRoot: true,
      defaultModel: model,
    });

    assert(typeof result === "string", "result should be a string");
    assertStringIncludes(result, "Echo");
  },
});

Deno.test({
  name: "[e2e] suspense root deck completes via slow_action",
  ignore: !provider,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const deckPath = path.resolve("examples/suspense/root.deck.ts");
    const result = await runDeck({
      path: deckPath,
      input: "hi",
      modelProvider: provider!,
      isRoot: true,
      defaultModel: model,
    });

    assert(typeof result === "string", "result should be a string");
    const lower = result.toLowerCase();
    assert(
      lower.includes("done") || lower.includes("complete"),
      "result should mention completion",
    );
  },
});

Deno.test({
  name: "[e2e] respond deck finishes via gambit_respond",
  ignore: !provider,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const deckPath = path.resolve("examples/respond/respond.deck.ts");
    const result = await runDeck({
      path: deckPath,
      input: "",
      modelProvider: provider!,
      isRoot: true,
      defaultModel: model,
    });

    assert(typeof result === "string", "result should be a string");
    assertStringIncludes(result, "ok");
  },
});
