import type { ModelProvider } from "@bolt-foundry/gambit-core";

export type ProviderKey = "openrouter" | "ollama" | "google" | "codex-cli";

export type ProviderRouter = {
  resolve: (input: { model: string }) => {
    providerKey: ProviderKey;
    provider: ModelProvider;
    model: string;
  };
};

type ProviderSet = Partial<Record<ProviderKey, ModelProvider | null>>;

const PROVIDER_PREFIXES: Record<ProviderKey, string> = {
  openrouter: "openrouter/",
  ollama: "ollama/",
  google: "google/",
  "codex-cli": "codex-cli/",
};

function parsePrefixedModel(model: string): {
  providerKey?: ProviderKey;
  strippedModel: string;
  rawModel: string;
  legacyCodex?: boolean;
} {
  if (model.trim() === "codex-cli") {
    return {
      providerKey: "codex-cli",
      strippedModel: "default",
      rawModel: model,
    };
  }
  for (const [providerKey, prefix] of Object.entries(PROVIDER_PREFIXES)) {
    if (model.startsWith(prefix)) {
      return {
        providerKey: providerKey as ProviderKey,
        strippedModel: model.slice(prefix.length),
        rawModel: model,
      };
    }
  }
  if (model === "codex" || model.startsWith("codex/")) {
    return {
      strippedModel: model,
      rawModel: model,
      legacyCodex: true,
    };
  }
  return { strippedModel: model, rawModel: model };
}

function missingProviderMessage(providerKey: ProviderKey): string {
  switch (providerKey) {
    case "openrouter":
      return "OPENROUTER_API_KEY is required for openrouter/ models.";
    case "ollama":
      return "Ollama provider is not configured. Set OLLAMA_BASE_URL or OLLAMA_API_KEY.";
    case "google":
      return "Google provider is not configured. Set GOOGLE_API_KEY or GEMINI_API_KEY.";
    case "codex-cli":
      return "Codex CLI provider is not configured.";
  }
}

export function createProviderRouter(opts: {
  providers: ProviderSet;
  defaultProvider?: ProviderKey | null;
  fallbackToDefaultOnMissing?: Array<ProviderKey>;
}): ProviderRouter {
  const defaultProvider = opts.defaultProvider === null
    ? null
    : (opts.defaultProvider ?? "openrouter");
  const fallbackOnMissing = new Set(
    opts.fallbackToDefaultOnMissing ?? ["google"],
  );
  return {
    resolve({ model }) {
      const { providerKey, strippedModel, rawModel, legacyCodex } =
        parsePrefixedModel(
          model,
        );
      if (legacyCodex) {
        throw new Error(
          'Legacy Codex model prefix "codex" is no longer supported. Use "codex-cli/default" or "codex-cli/<model>".',
        );
      }
      if (providerKey) {
        const provider = opts.providers[providerKey];
        if (!provider) {
          if (
            fallbackOnMissing.has(providerKey) &&
            defaultProvider !== null &&
            defaultProvider !== providerKey
          ) {
            const fallbackProvider = opts.providers[defaultProvider];
            if (fallbackProvider) {
              return {
                providerKey: defaultProvider,
                provider: fallbackProvider,
                model: rawModel,
              };
            }
          }
          throw new Error(missingProviderMessage(providerKey));
        }
        return {
          providerKey,
          provider,
          model: strippedModel,
        };
      }

      if (defaultProvider === null) {
        throw new Error(
          "No fallback provider configured. Use a provider prefix or set providers.fallback in gambit.toml.",
        );
      }
      const provider = opts.providers[defaultProvider];
      if (!provider) {
        throw new Error(
          "OPENROUTER_API_KEY is required when no provider prefix is specified.",
        );
      }
      return {
        providerKey: defaultProvider,
        provider,
        model,
      };
    },
  };
}
