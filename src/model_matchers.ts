import type { ProviderKey } from "./providers/router.ts";
import { GOOGLE_PREFIX } from "./providers/google.ts";
import { OLLAMA_PREFIX } from "./providers/ollama.ts";
import { OPENROUTER_PREFIX } from "./providers/openrouter.ts";

export type ProviderMatchers = {
  isUnprefixedModel: (model: string) => boolean;
  matchesOpenRouter: (model: string) => boolean;
  matchesOllama: (model: string) => boolean;
  matchesGoogle: (model: string) => boolean;
};

export function createProviderMatchers(
  effectiveFallbackProvider: ProviderKey | null,
): ProviderMatchers {
  const isUnprefixedModel = (model: string): boolean =>
    !model.startsWith(OPENROUTER_PREFIX) &&
    !model.startsWith(OLLAMA_PREFIX) &&
    !model.startsWith(GOOGLE_PREFIX);

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
  };
}
