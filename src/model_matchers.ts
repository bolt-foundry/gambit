import type { ProviderKey } from "./providers/router.ts";
import { GOOGLE_PREFIX } from "./providers/google.ts";
import { OLLAMA_PREFIX } from "./providers/ollama.ts";
import { OPENROUTER_PREFIX } from "./providers/openrouter.ts";
import { CODEX_PREFIX } from "./providers/codex.ts";

const LEGACY_CODEX_PREFIX = "codex/";
const CODEX_PROVIDER_ALIAS = "codex-cli";

export type ProviderMatchers = {
  isUnprefixedModel: (model: string) => boolean;
  matchesOpenRouter: (model: string) => boolean;
  matchesOllama: (model: string) => boolean;
  matchesGoogle: (model: string) => boolean;
  matchesCodex: (model: string) => boolean;
};

export function createProviderMatchers(
  effectiveFallbackProvider: ProviderKey | null,
): ProviderMatchers {
  const isUnprefixedModel = (model: string): boolean =>
    model.trim() !== CODEX_PROVIDER_ALIAS &&
    !model.startsWith(OPENROUTER_PREFIX) &&
    !model.startsWith(OLLAMA_PREFIX) &&
    !model.startsWith(GOOGLE_PREFIX) &&
    !model.startsWith(CODEX_PREFIX) &&
    !model.startsWith(LEGACY_CODEX_PREFIX);

  return {
    isUnprefixedModel,
    matchesOpenRouter: (model: string) =>
      model.startsWith(OPENROUTER_PREFIX) ||
      (isUnprefixedModel(model) && effectiveFallbackProvider === "openrouter"),
    matchesOllama: (model: string) =>
      model.startsWith(OLLAMA_PREFIX) ||
      (isUnprefixedModel(model) && effectiveFallbackProvider === "ollama"),
    matchesGoogle: (model: string) =>
      model.startsWith(GOOGLE_PREFIX) ||
      (isUnprefixedModel(model) && effectiveFallbackProvider === "google"),
    matchesCodex: (model: string) =>
      model.trim() === CODEX_PROVIDER_ALIAS ||
      model.startsWith(CODEX_PREFIX) ||
      (isUnprefixedModel(model) && effectiveFallbackProvider === "codex-cli"),
  };
}
