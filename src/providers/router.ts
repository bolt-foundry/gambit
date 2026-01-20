import type { ModelProvider } from "@bolt-foundry/gambit-core";

export type ModelProviderRoute = {
  prefix: string;
  provider: ModelProvider;
};

function normalizePrefix(prefix: string): string {
  return prefix.trim().toLowerCase();
}

export function createModelRouterProvider(opts: {
  routes: Array<ModelProviderRoute>;
  fallback?: ModelProvider;
}): ModelProvider {
  const routes = opts.routes.map((route) => ({
    prefix: normalizePrefix(route.prefix),
    provider: route.provider,
  }));
  const fallback = opts.fallback;

  return {
    responses: (input) => {
      const model = input.model ?? "";
      const normalized = model.toLowerCase();
      const match = routes.find((route) => normalized.startsWith(route.prefix));
      if (match) return match.provider.responses(input);
      if (fallback) return fallback.responses(input);
      throw new Error(
        `No provider registered for model "${model}". Configure OpenRouter or add a provider route.`,
      );
    },
  };
}
