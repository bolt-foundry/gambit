import { assertEquals, assertExists } from "@std/assert";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import {
  getProviderManifest,
  getProviderManifests,
  getProviderRegistryEntries,
} from "./manifest.ts";
import {
  getProviderRequirements,
  providerAuthUsesMitmRequestTimeAttachment,
  providerAuthUsesRuntimeEnvPlaceholders,
  resolveProviderRequirements,
} from "./requirements.ts";
import { createProviderRouter } from "./router.ts";

const stubProvider = (): ModelProvider => ({
  chat: () =>
    Promise.resolve({
      message: { role: "assistant", content: "ok" },
      finishReason: "stop",
    }),
});

Deno.test("provider requirements expose codex auth contract", () => {
  const manifest = getProviderManifest("codex-cli");
  assertExists(manifest);
  assertEquals(manifest.provider, {
    key: "codex-cli",
    entrypoint: "../codex.ts",
    routingPrefix: "codex-cli/",
    bareAlias: "codex-cli",
  });
  const requirements = getProviderRequirements("codex-cli");
  assertExists(requirements);
  assertEquals(requirements.provider, "codex-cli");
  assertEquals(requirements.auth, {
    mode: "chatgpt-auth-tokens",
    storageAuthority: "bfdesktop",
    attachmentAuthority: "bfdesktop-mitm",
    destinationScope: "declared-destinations",
  });
  assertEquals(requirements.destinations, [
    { url: "https://api.openai.com/v1/responses" },
    { url: "https://auth.openai.com/oauth/token" },
    { url: "https://chatgpt.com/backend-api/codex/" },
  ]);
  assertEquals(providerAuthUsesMitmRequestTimeAttachment(requirements), true);
});

Deno.test("provider requirements keep a secret-mode path for API-key providers", () => {
  const manifest = getProviderManifest("openrouter");
  assertExists(manifest);
  assertEquals(manifest.provider, {
    key: "openrouter",
    entrypoint: "../openrouter.ts",
    routingPrefix: "openrouter/",
  });
  const requirements = getProviderRequirements("openrouter");
  assertExists(requirements);
  assertEquals(requirements.auth, {
    mode: "secret",
    storageAuthority: "bfdesktop",
    attachmentAuthority: "runtime-env-placeholder",
    destinationScope: "declared-destinations",
    secrets: [{
      secretId: "openrouter-api-key",
      envName: "OPENROUTER_API_KEY",
    }],
  });
  assertEquals(requirements.destinations, [
    { url: "https://openrouter.ai/api/v1/" },
  ]);
  assertEquals(providerAuthUsesRuntimeEnvPlaceholders(requirements), true);
});

Deno.test("provider manifests expose registry metadata for every provider", () => {
  assertEquals(
    getProviderManifests().map((manifest) => manifest.provider.key),
    [
      "claude-code-cli",
      "codex-cli",
      "google",
      "ollama",
      "openrouter",
    ],
  );
  assertEquals(
    getProviderRegistryEntries(),
    [
      {
        key: "claude-code-cli",
        entrypoint: "../claude_code.ts",
        routingPrefix: "claude-code-cli/",
        bareAlias: "claude-code-cli",
      },
      {
        key: "codex-cli",
        entrypoint: "../codex.ts",
        routingPrefix: "codex-cli/",
        bareAlias: "codex-cli",
      },
      {
        key: "google",
        entrypoint: "../google.ts",
        routingPrefix: "google/",
      },
      {
        key: "ollama",
        entrypoint: "../ollama.ts",
        routingPrefix: "ollama/",
      },
      {
        key: "openrouter",
        entrypoint: "../openrouter.ts",
        routingPrefix: "openrouter/",
      },
    ],
  );
});

Deno.test("provider requirements resolve codex-cli/default without ambiguity", () => {
  const resolved = resolveProviderRequirements({ model: "codex-cli/default" });
  assertExists(resolved);
  assertEquals(resolved.providerKey, "codex-cli");
  assertEquals(resolved.model, "default");
});

Deno.test("provider requirements resolve codex-cli/<model> without ambiguity", () => {
  const resolved = resolveProviderRequirements({
    model: "codex-cli/gpt-5.2-codex",
  });
  assertExists(resolved);
  assertEquals(resolved.providerKey, "codex-cli");
  assertEquals(resolved.model, "gpt-5.2-codex");
});

Deno.test("provider requirements remain absent for providers without auth declarations", () => {
  assertEquals(getProviderRequirements("google"), null);
  assertEquals(getProviderRequirements("ollama"), null);
  assertEquals(getProviderRequirements("claude-code-cli"), null);
});

Deno.test("provider routing identity stays aligned with provider requirements", () => {
  const router = createProviderRouter({
    providers: {
      openrouter: stubProvider(),
      "codex-cli": stubProvider(),
    },
  });
  for (
    const model of [
      "codex-cli",
      "codex-cli/default",
      "codex-cli/gpt-5.2-codex",
    ]
  ) {
    const routed = router.resolve({ model });
    const requirements = resolveProviderRequirements({ model });
    assertExists(requirements);
    assertEquals(requirements.providerKey, routed.providerKey);
  }
});

Deno.test("provider routing identity stays aligned with provider registry metadata", () => {
  const router = createProviderRouter({
    providers: {
      openrouter: stubProvider(),
      google: stubProvider(),
      ollama: stubProvider(),
      "codex-cli": stubProvider(),
      "claude-code-cli": stubProvider(),
    },
  });
  for (
    const [model, providerKey] of [
      ["openrouter/gpt-4o", "openrouter"],
      ["google/gemini-2.0-flash", "google"],
      ["ollama/llama3.2", "ollama"],
      ["codex-cli", "codex-cli"],
      ["claude-code-cli", "claude-code-cli"],
    ] as const
  ) {
    const routed = router.resolve({ model });
    const manifest = getProviderManifest(providerKey);
    assertExists(manifest);
    assertEquals(routed.providerKey, manifest.provider.key);
    assertEquals(
      model.startsWith(manifest.provider.routingPrefix) ||
        model === manifest.provider.bareAlias,
      true,
    );
  }
});
