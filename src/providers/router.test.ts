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
  const codexCli = stubProvider("codex-cli");
  const claudeCode = stubProvider("claude-code-cli");
  const router = createProviderRouter({
    providers: {
      openrouter,
      ollama,
      "codex-cli": codexCli,
      "claude-code-cli": claudeCode,
    },
  });

  const selection = router.resolve({ model: "ollama/llama3" });
  assertEquals(selection.providerKey, "ollama");
  assertEquals(selection.provider, ollama);
  assertEquals(selection.model, "llama3");

  const codexSelection = router.resolve({ model: "codex-cli/default" });
  assertEquals(codexSelection.providerKey, "codex-cli");
  assertEquals(codexSelection.provider, codexCli);
  assertEquals(codexSelection.model, "default");

  const claudeSelection = router.resolve({
    model: "claude-code-cli/default",
  });
  assertEquals(claudeSelection.providerKey, "claude-code-cli");
  assertEquals(claudeSelection.provider, claudeCode);
  assertEquals(claudeSelection.model, "default");
});

Deno.test("provider router maps bare codex-cli to codex-cli/default", () => {
  const codexCli = stubProvider("codex-cli");
  const router = createProviderRouter({
    providers: { "codex-cli": codexCli },
    defaultProvider: null,
  });
  const selection = router.resolve({ model: "codex-cli" });
  assertEquals(selection.providerKey, "codex-cli");
  assertEquals(selection.provider, codexCli);
  assertEquals(selection.model, "default");
});

Deno.test(
  "provider router maps bare claude-code-cli to claude-code-cli/default",
  () => {
    const claudeCode = stubProvider("claude-code-cli");
    const router = createProviderRouter({
      providers: { "claude-code-cli": claudeCode },
      defaultProvider: null,
    });
    const selection = router.resolve({ model: "claude-code-cli" });
    assertEquals(selection.providerKey, "claude-code-cli");
    assertEquals(selection.provider, claudeCode);
    assertEquals(selection.model, "default");
  },
);

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

Deno.test("provider router rejects legacy codex prefixes", () => {
  const openrouter = stubProvider("openrouter");
  const router = createProviderRouter({
    providers: { openrouter },
  });
  const error = assertThrows(() => router.resolve({ model: "codex/default" }));
  assertEquals(error instanceof Error, true);
  assertEquals(
    (error as Error).message.includes('Legacy Codex model prefix "codex"'),
    true,
  );
});
