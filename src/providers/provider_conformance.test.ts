import { assert, assertEquals } from "@std/assert";
import {
  createAnthropicProvider,
  createGeminiProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
} from "./mod.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";

type ProviderConfig = {
  name: string;
  envKey: string;
  modelEnvKey: string;
  defaultModel: string;
  create: (apiKey: string) => ModelProvider;
};

const providers: Array<ProviderConfig> = [
  {
    name: "openrouter",
    envKey: "OPENROUTER_API_KEY",
    modelEnvKey: "OPENROUTER_TEST_MODEL",
    defaultModel: "openai/o4-mini",
    create: (apiKey) =>
      createOpenRouterProvider({
        apiKey,
        baseURL: Deno.env.get("OPENROUTER_BASE_URL") ?? undefined,
      }),
  },
  {
    name: "gemini",
    envKey: "GEMINI_API_KEY",
    modelEnvKey: "GEMINI_TEST_MODEL",
    defaultModel: "google/gemini-2.0-flash",
    create: (apiKey) =>
      createGeminiProvider({
        apiKey,
        baseURL: Deno.env.get("GEMINI_BASE_URL") ?? undefined,
      }),
  },
  {
    name: "openai",
    envKey: "OPENAI_API_KEY",
    modelEnvKey: "OPENAI_TEST_MODEL",
    defaultModel: "gpt-4.1-mini",
    create: (apiKey) =>
      createOpenAIProvider({
        apiKey,
        baseURL: Deno.env.get("OPENAI_BASE_URL") ?? undefined,
      }),
  },
  {
    name: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
    modelEnvKey: "ANTHROPIC_TEST_MODEL",
    defaultModel: "claude-3-5-sonnet-20240620",
    create: (apiKey) =>
      createAnthropicProvider({
        apiKey,
        baseURL: Deno.env.get("ANTHROPIC_BASE_URL") ?? undefined,
      }),
  },
];

function getProviderEnv(
  config: ProviderConfig,
): { key?: string; model: string } {
  const key = Deno.env.get(config.envKey) ?? undefined;
  const model = Deno.env.get(config.modelEnvKey) ?? config.defaultModel;
  return { key, model };
}

for (const provider of providers) {
  const { key, model } = getProviderEnv(provider);
  const shouldIgnore = !key;

  Deno.test({
    name: `provider suitability: ${provider.name} non-stream`,
    ignore: shouldIgnore,
    fn: async () => {
      const instance = provider.create(key!);
      const response = await instance.responses({
        model,
        input: "ping",
        stream: false,
      });
      assertEquals(response.status, response.status ?? "completed");
      assert(response.output?.length ?? 0);
    },
  });

  Deno.test({
    name: `provider suitability: ${provider.name} stream`,
    ignore: shouldIgnore,
    fn: async () => {
      const instance = provider.create(key!);
      const events: Array<string> = [];
      const response = await instance.responses({
        model,
        input: "ping",
        stream: true,
        onStreamEvent: (event) => {
          if (event.type) events.push(event.type);
        },
      });
      assertEquals(response.status, response.status ?? "completed");
      assert(events.length > 0);
    },
  });
}
