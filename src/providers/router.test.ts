import { assertEquals, assertThrows } from "@std/assert";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import { createProviderRouter } from "./router.ts";

const stubProvider = (label: string): ModelProvider => ({
  chat: () =>
    Promise.resolve({
      message: { role: "assistant", content: label },
      finishReason: "stop",
    }),
});

Deno.test("provider router selects prefixed provider", () => {
  const openrouter = stubProvider("openrouter");
  const ollama = stubProvider("ollama");
  const router = createProviderRouter({
    providers: { openrouter, ollama },
  });

  const selection = router.resolve({ model: "ollama/llama3" });
  assertEquals(selection.providerKey, "ollama");
  assertEquals(selection.provider, ollama);
  assertEquals(selection.model, "llama3");
});

Deno.test("provider router defaults to openrouter when no prefix", () => {
  const openrouter = stubProvider("openrouter");
  const router = createProviderRouter({
    providers: { openrouter },
  });

  const selection = router.resolve({ model: "openai/gpt-4o" });
  assertEquals(selection.providerKey, "openrouter");
  assertEquals(selection.provider, openrouter);
  assertEquals(selection.model, "openai/gpt-4o");
});

Deno.test("provider router falls back for missing google provider", () => {
  const openrouter = stubProvider("openrouter");
  const router = createProviderRouter({
    providers: { openrouter },
  });

  const selection = router.resolve({ model: "google/gemini-1.5-pro" });
  assertEquals(selection.providerKey, "openrouter");
  assertEquals(selection.provider, openrouter);
  assertEquals(selection.model, "google/gemini-1.5-pro");
});

Deno.test("provider router throws when no default provider is available", () => {
  const router = createProviderRouter({
    providers: {},
    defaultProvider: null,
  });

  const error = assertThrows(() => router.resolve({ model: "openai/gpt-4o" }));
  assertEquals(error instanceof Error, true);
  assertEquals(
    (error as Error).message.includes(
      "No fallback provider configured. Use a provider prefix or set providers.fallback in gambit.toml.",
    ),
    true,
  );
});
