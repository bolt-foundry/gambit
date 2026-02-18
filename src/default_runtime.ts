import { runDeck as runDeckCore } from "@bolt-foundry/gambit-core";
import type {
  CreateResponseRequest,
  ModelMessage,
  ModelProvider,
  ResponseEvent,
  SavedState,
  ToolDefinition,
} from "@bolt-foundry/gambit-core";
import { createProviderMatchers } from "./model_matchers.ts";
import {
  type SessionArtifactsConfig,
  withSessionArtifacts,
} from "./session_artifacts.ts";
import {
  createModelAliasResolver,
  type GambitConfig,
  type LoadedProjectConfig,
  loadProjectConfig,
  type ModelAliasResolver,
} from "./project_config.ts";
import { CODEX_PREFIX, createCodexProvider } from "./providers/codex.ts";
import { createGoogleProvider } from "./providers/google.ts";
import {
  createOllamaProvider,
  ensureOllamaModel,
  fetchOllamaTags,
  OLLAMA_PREFIX,
} from "./providers/ollama.ts";
import { createOpenRouterProvider } from "./providers/openrouter.ts";
import { createProviderRouter, type ProviderKey } from "./providers/router.ts";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

type WarnLogger = Pick<Console, "warn">;

type ModelCandidate = {
  model: string;
  params?: Record<string, unknown>;
};

type ProviderAvailability = {
  available: boolean;
  reason?: string;
};

type ProviderCapability = {
  name: string;
  matches: (model: string) => boolean;
  isAvailable: (model: string, opts: { allowPull: boolean }) => Promise<
    ProviderAvailability
  >;
};

type CoreRunDeckOptions = Parameters<typeof runDeckCore>[0];

export type DefaultedRuntimeRunOptions =
  & Omit<
    CoreRunDeckOptions,
    | "modelProvider"
    | "defaultModel"
    | "modelOverride"
    | "responsesMode"
  >
  & {
    modelProvider?: ModelProvider;
    defaultModel?: string;
    modelOverride?: string;
    responsesMode?: boolean;
    sessionArtifacts?: SessionArtifactsConfig | false;
  };

export type CreateDefaultedRuntimeOptions = {
  configHint?: string;
  projectConfig?: LoadedProjectConfig | null;
  modelProvider?: ModelProvider;
  defaultModel?: string;
  modelOverride?: string;
  responsesMode?: boolean;
  fallbackProvider?: ProviderKey | null;
  logger?: WarnLogger;
  sessionArtifacts?: SessionArtifactsConfig;
};

export type DefaultedRuntime = {
  projectConfig: LoadedProjectConfig | null;
  modelAliasResolver: ModelAliasResolver;
  configuredFallbackProvider: ProviderKey | null | undefined;
  effectiveFallbackProvider: ProviderKey | null;
  modelProvider: ModelProvider;
  defaultModel?: string;
  modelOverride?: string;
  responsesMode: boolean;
  sessionArtifacts?: SessionArtifactsConfig;
  resolveRunOptions: (opts: DefaultedRuntimeRunOptions) => CoreRunDeckOptions;
  runDeck: (opts: DefaultedRuntimeRunOptions) => Promise<unknown>;
};

export type RunDeckWithDefaultsOptions = DefaultedRuntimeRunOptions & {
  runtime?: DefaultedRuntime;
  runtimeOptions?: CreateDefaultedRuntimeOptions;
};

function mergeParams(
  aliasParams?: Record<string, unknown>,
  baseParams?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (aliasParams && baseParams) {
    return { ...aliasParams, ...baseParams };
  }
  return baseParams ?? aliasParams;
}

function parseFallbackProviderFromConfig(
  fallbackProviderRaw: unknown,
  logger: WarnLogger,
): ProviderKey | null | undefined {
  if (typeof fallbackProviderRaw !== "string") {
    return undefined;
  }
  const normalized = fallbackProviderRaw.trim().toLowerCase();
  if (normalized === "none") {
    return null;
  }
  if (normalized === "codex") {
    throw new Error(
      '[gambit] providers.fallback "codex" is no longer supported. Use "codex-cli" or "none".',
    );
  }
  if (
    normalized === "openrouter" || normalized === "ollama" ||
    normalized === "google" || normalized === "codex-cli"
  ) {
    return normalized as ProviderKey;
  }
  if (normalized.length > 0) {
    logger.warn(
      `[gambit] Unknown providers.fallback "${fallbackProviderRaw}" in gambit.toml; using default fallback.`,
    );
  }
  return undefined;
}

function resolveConfiguredFallbackProvider(opts: {
  runtimeOverride?: ProviderKey | null;
  projectConfig?: GambitConfig | null;
  logger: WarnLogger;
}): ProviderKey | null | undefined {
  if (opts.runtimeOverride !== undefined) {
    return opts.runtimeOverride;
  }
  return parseFallbackProviderFromConfig(
    opts.projectConfig?.providers?.fallback,
    opts.logger,
  );
}

function resolveDefaultResponsesMode(): boolean {
  const chatFallback = Deno.env.get("GAMBIT_CHAT_FALLBACK") === "1";
  return !chatFallback && Deno.env.get("GAMBIT_RESPONSES_MODE") !== "0";
}

function resolveSessionArtifactsConfig(opts: {
  runtimeConfig?: SessionArtifactsConfig;
  runConfig?: SessionArtifactsConfig | false;
}): SessionArtifactsConfig | undefined {
  if (opts.runConfig === false) return undefined;
  if (!opts.runtimeConfig && !opts.runConfig) return undefined;
  const merged = {
    ...(opts.runtimeConfig ?? {}),
    ...(opts.runConfig ?? {}),
  };
  if (typeof merged.rootDir !== "string" || !merged.rootDir.trim()) {
    throw new Error(
      "sessionArtifacts.rootDir is required when persistence is enabled.",
    );
  }
  return {
    rootDir: merged.rootDir,
    sessionId: merged.sessionId,
    continueSession: merged.continueSession,
  };
}

function buildDefaultModelProvider(opts: {
  modelAliasResolver: ModelAliasResolver;
  configuredFallbackProvider: ProviderKey | null | undefined;
  effectiveFallbackProvider: ProviderKey | null;
  responsesMode: boolean;
  logger: WarnLogger;
}): ModelProvider {
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  const googleApiKey = (Deno.env.get("GOOGLE_API_KEY") ??
    Deno.env.get("GEMINI_API_KEY"))?.trim();
  const openRouterBaseURL = Deno.env.get("OPENROUTER_BASE_URL") ??
    DEFAULT_OPENROUTER_BASE_URL;
  const ollamaBaseURL = Deno.env.get("OLLAMA_BASE_URL") ?? undefined;
  const googleBaseURL = Deno.env.get("GOOGLE_BASE_URL") ??
    Deno.env.get("GEMINI_BASE_URL") ??
    undefined;

  const openRouterProvider = openRouterApiKey
    ? createOpenRouterProvider({
      apiKey: openRouterApiKey,
      baseURL: openRouterBaseURL ?? undefined,
      enableResponses: opts.responsesMode &&
        Deno.env.get("GAMBIT_OPENROUTER_RESPONSES") !== "0",
    })
    : null;
  const ollamaProvider = createOllamaProvider({
    apiKey: Deno.env.get("OLLAMA_API_KEY")?.trim() || undefined,
    baseURL: ollamaBaseURL,
  });
  const googleProvider = googleApiKey
    ? createGoogleProvider({
      apiKey: googleApiKey,
      baseURL: googleBaseURL,
    })
    : null;
  const codexProvider = createCodexProvider();

  const providerRouter = createProviderRouter({
    providers: {
      openrouter: openRouterProvider,
      ollama: ollamaProvider,
      google: googleProvider,
      "codex-cli": codexProvider,
    },
    defaultProvider: opts.configuredFallbackProvider,
    fallbackToDefaultOnMissing: ["google"],
  });

  const providerMatchers = createProviderMatchers(
    opts.effectiveFallbackProvider,
  );
  const ollamaTagsCache: { promise: Promise<Set<string>> | null } = {
    promise: null,
  };
  const getOllamaTags = async (): Promise<Set<string>> => {
    if (!ollamaTagsCache.promise) {
      ollamaTagsCache.promise = fetchOllamaTags(ollamaBaseURL);
    }
    return await ollamaTagsCache.promise;
  };
  const providerCapabilities: Array<ProviderCapability> = [
    {
      name: "ollama",
      matches: providerMatchers.matchesOllama,
      isAvailable: async (model, capabilityOpts) => {
        const trimmed = model.slice(OLLAMA_PREFIX.length);
        if (!trimmed) {
          return { available: false, reason: "missing Ollama model name" };
        }
        if (capabilityOpts.allowPull) {
          try {
            await ensureOllamaModel(trimmed, ollamaBaseURL);
            return { available: true };
          } catch (err) {
            return {
              available: false,
              reason: err instanceof Error ? err.message : String(err),
            };
          }
        }
        try {
          const tags = await getOllamaTags();
          if (tags.has(trimmed)) {
            return { available: true };
          }
          return {
            available: false,
            reason: `Ollama model "${trimmed}" not installed`,
          };
        } catch (err) {
          return {
            available: false,
            reason: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
    {
      name: "google",
      matches: providerMatchers.matchesGoogle,
      isAvailable: (_model, _capabilityOpts) =>
        Promise.resolve(
          googleApiKey
            ? { available: true }
            : (opts.effectiveFallbackProvider === "openrouter" &&
                openRouterApiKey)
            ? { available: true }
            : {
              available: false,
              reason: "GOOGLE_API_KEY or GEMINI_API_KEY is not set",
            },
        ),
    },
    {
      name: "openrouter",
      matches: providerMatchers.matchesOpenRouter,
      isAvailable: (_model, _capabilityOpts) =>
        Promise.resolve(
          openRouterApiKey ? { available: true } : {
            available: false,
            reason: "OPENROUTER_API_KEY is not set",
          },
        ),
    },
    {
      name: "codex-cli",
      matches: providerMatchers.matchesCodex,
      isAvailable: (model, _capabilityOpts) => {
        if (model === "codex" || model.startsWith("codex/")) {
          return Promise.resolve({
            available: false,
            reason:
              'legacy codex prefix is unsupported; use "codex-cli/default" or "codex-cli/<model>"',
          });
        }
        const stripped = model.startsWith(CODEX_PREFIX)
          ? model.slice(CODEX_PREFIX.length)
          : model;
        if (!stripped.trim()) {
          return Promise.resolve({
            available: false,
            reason: "missing Codex model name",
          });
        }
        return Promise.resolve({ available: true });
      },
    },
  ];
  const warnedMissingAliases = new Set<string>();
  const expandModelCandidates = (
    model: string | Array<string> | undefined,
    params?: Record<string, unknown>,
  ): {
    candidates: Array<ModelCandidate>;
    allowPull: boolean;
  } => {
    if (!model) return { candidates: [], allowPull: false };
    const baseParams = params;
    const entries = Array.isArray(model) ? model : [model];
    const allowPull = !Array.isArray(model);
    const candidates: Array<ModelCandidate> = [];
    for (const entry of entries) {
      if (typeof entry !== "string" || !entry.trim()) continue;
      const resolution = opts.modelAliasResolver(entry);
      if (resolution.missingAlias && !warnedMissingAliases.has(entry)) {
        opts.logger.warn(
          `[gambit] Model alias "${entry}" is not defined in gambit.toml; using literal value.`,
        );
        warnedMissingAliases.add(entry);
      }
      if (resolution.applied) {
        const resolvedModel = resolution.model;
        const mergedParams = mergeParams(resolution.params, baseParams);
        if (Array.isArray(resolvedModel)) {
          for (const candidate of resolvedModel) {
            if (!candidate.trim()) continue;
            candidates.push({
              model: candidate,
              params: mergedParams,
            });
          }
        } else if (resolvedModel) {
          candidates.push({
            model: resolvedModel,
            params: mergedParams,
          });
        }
      } else {
        candidates.push({
          model: entry,
          params: baseParams,
        });
      }
    }
    const allowPullForSingle = allowPull && candidates.length <= 1;
    return { candidates, allowPull: allowPullForSingle };
  };
  const resolveModelSelection = async (
    model: string | Array<string>,
    params?: Record<string, unknown>,
    deckPath?: string,
  ): Promise<{ model: string; params?: Record<string, unknown> }> => {
    const { candidates, allowPull } = expandModelCandidates(model, params);
    if (candidates.length === 0) {
      throw new Error(
        deckPath
          ? `No model configured for deck ${deckPath}`
          : "No model configured.",
      );
    }
    const failures: Array<string> = [];
    for (const candidate of candidates) {
      const capability = providerCapabilities.find((entry) =>
        entry.matches(candidate.model)
      );
      const availability = capability
        ? await capability.isAvailable(candidate.model, { allowPull })
        : {
          available: false,
          reason: "no provider registered for model",
        };
      if (availability.available) {
        return {
          model: candidate.model,
          params: candidate.params,
        };
      }
      const label = capability ? capability.name : "unknown";
      const reason = availability.reason ? `: ${availability.reason}` : "";
      failures.push(`${candidate.model} (${label}${reason})`);
    }
    const suffix = failures.length ? ` Tried: ${failures.join(", ")}.` : "";
    throw new Error(
      deckPath
        ? `No available model found for deck ${deckPath}.${suffix}`
        : `No available model found.${suffix}`,
    );
  };
  const shouldResolveModel = (model: string | Array<string>): boolean => {
    if (Array.isArray(model)) return true;
    const resolution = opts.modelAliasResolver(model);
    return Boolean(resolution.applied || resolution.missingAlias);
  };

  return {
    resolveModel: async (input) =>
      await resolveModelSelection(
        input.model,
        input.params,
        input.deckPath,
      ),
    responses: async (input: {
      request: CreateResponseRequest;
      state?: SavedState;
      deckPath?: string;
      onStreamEvent?: (event: ResponseEvent) => void;
    }) => {
      const applied = shouldResolveModel(input.request.model)
        ? await resolveModelSelection(
          input.request.model,
          input.request.params,
          input.deckPath,
        )
        : { model: input.request.model, params: input.request.params };
      const request = {
        ...input.request,
        model: applied.model ?? input.request.model,
        params: applied.params,
      };
      if (typeof request.model !== "string" || !request.model) {
        throw new Error("Model is required.");
      }
      const selection = providerRouter.resolve({ model: request.model });
      const responses = selection.provider.responses;
      if (!responses) {
        throw new Error(
          `${selection.providerKey} provider does not support responses.`,
        );
      }
      return await responses({
        ...input,
        request: {
          ...request,
          model: selection.model,
        },
      });
    },
    chat: async (input: {
      model: string;
      messages: Array<ModelMessage>;
      tools?: Array<ToolDefinition>;
      stream?: boolean;
      state?: SavedState;
      deckPath?: string;
      onStreamText?: (chunk: string) => void;
      params?: Record<string, unknown>;
    }) => {
      const applied = shouldResolveModel(input.model)
        ? await resolveModelSelection(input.model, input.params, input.deckPath)
        : { model: input.model, params: input.params };
      const request = {
        ...input,
        model: applied.model ?? input.model,
        params: applied.params,
      };
      if (typeof request.model !== "string" || !request.model) {
        throw new Error("Model is required.");
      }
      const selection = providerRouter.resolve({ model: request.model });
      return await selection.provider.chat({
        ...request,
        model: selection.model,
      });
    },
  };
}

export async function createDefaultedRuntime(
  opts: CreateDefaultedRuntimeOptions = {},
): Promise<DefaultedRuntime> {
  const logger = opts.logger ?? console;
  const projectConfig = opts.projectConfig === undefined
    ? await loadProjectConfig(opts.configHint)
    : opts.projectConfig;
  const modelAliasResolver = createModelAliasResolver(projectConfig?.config);
  const configuredFallbackProvider = resolveConfiguredFallbackProvider({
    runtimeOverride: opts.fallbackProvider,
    projectConfig: projectConfig?.config,
    logger,
  });
  const effectiveFallbackProvider = configuredFallbackProvider === undefined
    ? "openrouter"
    : configuredFallbackProvider;
  const responsesMode = opts.responsesMode ?? resolveDefaultResponsesMode();
  const modelProvider = opts.modelProvider ??
    buildDefaultModelProvider({
      modelAliasResolver,
      configuredFallbackProvider,
      effectiveFallbackProvider,
      responsesMode,
      logger,
    });
  const defaultModel = opts.defaultModel;
  const modelOverride = opts.modelOverride;
  const runtimeSessionArtifacts = opts.sessionArtifacts;

  const resolveRunOptions = (
    runOpts: DefaultedRuntimeRunOptions,
  ): CoreRunDeckOptions => {
    const { sessionArtifacts: _sessionArtifacts, ...coreRunOpts } = runOpts;
    return {
      ...coreRunOpts,
      modelProvider: runOpts.modelProvider ?? modelProvider,
      defaultModel: runOpts.defaultModel ?? defaultModel,
      modelOverride: runOpts.modelOverride ?? modelOverride,
      responsesMode: runOpts.responsesMode ?? responsesMode,
    };
  };

  return {
    projectConfig,
    modelAliasResolver,
    configuredFallbackProvider,
    effectiveFallbackProvider,
    modelProvider,
    defaultModel,
    modelOverride,
    responsesMode,
    sessionArtifacts: runtimeSessionArtifacts,
    resolveRunOptions,
    runDeck: async (runOpts) => {
      const resolved = resolveRunOptions(runOpts);
      const effectiveSessionArtifacts = resolveSessionArtifactsConfig({
        runtimeConfig: runtimeSessionArtifacts,
        runConfig: runOpts.sessionArtifacts,
      });
      if (!effectiveSessionArtifacts) {
        return await runDeckCore(resolved);
      }
      const artifacts = withSessionArtifacts({
        config: effectiveSessionArtifacts,
        trace: resolved.trace,
        onStateUpdate: resolved.onStateUpdate,
        state: resolved.state,
      });
      try {
        return await runDeckCore({
          ...resolved,
          state: artifacts.state,
          trace: artifacts.trace,
          onStateUpdate: artifacts.onStateUpdate,
        });
      } finally {
        artifacts.finalize();
      }
    },
  };
}

export async function runDeck(
  opts: RunDeckWithDefaultsOptions,
): Promise<unknown> {
  if (opts.runtime && opts.runtimeOptions) {
    throw new Error(
      "runDeck received both runtime and runtimeOptions. Pass only one.",
    );
  }
  const runtime = opts.runtime ??
    await createDefaultedRuntime({
      ...opts.runtimeOptions,
      configHint: opts.runtimeOptions?.configHint ?? opts.path,
    });
  const { runtime: _runtime, runtimeOptions: _runtimeOptions, ...runOpts } =
    opts;
  return await runtime.runDeck(runOpts);
}
