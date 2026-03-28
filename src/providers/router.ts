import type { ModelProvider } from "@bolt-foundry/gambit-core";

export type ProviderKey =
  | "openrouter"
  | "ollama"
  | "google"
  | "codex-cli"
  | "claude-code-cli";

export type ProviderRouter = {
  resolve: (input: { model: string }) => {
    providerKey: ProviderKey;
    provider: ModelProvider;
    model: string;
  };
};

export type ParsedProviderModel = {
  providerKey?: ProviderKey;
  strippedModel: string;
  rawModel: string;
  legacyCodex?: boolean;
};

export type ResolvedProviderIdentity = {
  providerKey: ProviderKey;
  model: string;
  rawModel: string;
  wasExplicit: boolean;
};

type ProviderSet = Partial<Record<ProviderKey, ModelProvider | null>>;

const PROVIDER_PREFIXES: Record<ProviderKey, string> = {
  openrouter: "openrouter/",
  ollama: "ollama/",
  google: "google/",
  "codex-cli": "codex-cli/",
  "claude-code-cli": "claude-code-cli/",
};

function parsePrefixedModel(model: string): ParsedProviderModel {
  if (model.trim() === "codex-cli") {
    return {
      providerKey: "codex-cli",
      strippedModel: "default",
      rawModel: model,
    };
  }
  if (model.trim() === "claude-code-cli") {
    return {
      providerKey: "claude-code-cli",
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

export function resolveProviderIdentity(input: {
  model: string;
  defaultProvider?: ProviderKey | null;
}): ResolvedProviderIdentity {
  const defaultProvider = input.defaultProvider === undefined
    ? "openrouter"
    : input.defaultProvider;
  const { providerKey, strippedModel, rawModel, legacyCodex } =
    parsePrefixedModel(input.model);
  if (legacyCodex) {
    throw new Error(
      'Legacy Codex model prefix "codex" is no longer supported. Use "codex-cli/default" or "codex-cli/<model>".',
    );
  }
  if (providerKey) {
    return {
      providerKey,
      model: strippedModel,
      rawModel,
      wasExplicit: true,
    };
  }
  if (defaultProvider === null) {
    throw new Error(
      "No fallback provider configured. Use a provider prefix or set providers.fallback in gambit.toml.",
    );
  }
  return {
    providerKey: defaultProvider,
    model: input.model,
    rawModel,
    wasExplicit: false,
  };
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
    case "claude-code-cli":
      return "Claude Code CLI provider is not configured.";
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
      const identity = resolveProviderIdentity({ model, defaultProvider });
      const { providerKey, model: strippedModel, rawModel, wasExplicit } =
        identity;
      if (wasExplicit) {
        const provider = opts.providers[providerKey];
        if (!provider) {
          if (
            fallbackOnMissing.has(providerKey) &&
            defaultProvider !== null &&
            defaultProvider !== providerKey
          ) {
            const fallbackProviderKey = defaultProvider as ProviderKey;
            const fallbackProvider = opts.providers[fallbackProviderKey];
            if (fallbackProvider) {
              return {
                providerKey: fallbackProviderKey,
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
      const fallbackProviderKey = defaultProvider as ProviderKey;
      const provider = opts.providers[fallbackProviderKey];
      if (!provider) {
        throw new Error(
          "OPENROUTER_API_KEY is required when no provider prefix is specified.",
        );
      }
      return {
        providerKey: fallbackProviderKey,
        provider,
        model,
      };
    },
  };
}
