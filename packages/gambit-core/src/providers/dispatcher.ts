import type { ModelProvider } from "../types.ts";

const logger = console;

/**
 * A ModelProvider that delegates to other providers based on model name prefixes.
 */
export function createDispatchingProvider(opts: {
  providers: Array<{ prefix: string; provider: ModelProvider }>;
  defaultProvider: ModelProvider;
}): ModelProvider {
  return {
    async chat(input) {
      const modelName = input.model;

      for (const { prefix, provider } of opts.providers) {
        if (modelName.startsWith(prefix)) {
          logger.log(
            `[Dispatcher] Routing model '${modelName}' to provider for prefix '${prefix}'`,
          );
          const strippedModel = modelName.substring(prefix.length);
          return provider.chat({
            ...input,
            model: strippedModel,
          });
        }
      }

      logger.log(
        `[Dispatcher] Model '${modelName}' has no prefix, using default provider.`,
      );
      return opts.defaultProvider.chat(input);
    },
  };
}
