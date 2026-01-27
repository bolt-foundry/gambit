#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/**
 * Gambit CLI entrypoint for running decks, REPLs, simulators, and tooling.
 *
 * @module
 */
import { parse } from "@std/jsonc";
import * as path from "@std/path";
import { load as loadDotenv } from "@std/dotenv";
import { makeConsoleTracer, makeJsonlTracer } from "./trace.ts";
import { startTui } from "./tui.ts";
import {
  createOllamaProvider,
  ensureOllamaModel,
  fetchOllamaTags,
  OLLAMA_PREFIX,
} from "./providers/ollama.ts";
import { createOpenRouterProvider } from "./providers/openrouter.ts";
import { createGoogleProvider } from "./providers/google.ts";
import { createProviderRouter } from "./providers/router.ts";
import { createProviderMatchers } from "./model_matchers.ts";
import { handleCheckCommand } from "./commands/check.ts";
import { handleRunCommand } from "./commands/run.ts";
import { handleServeCommand } from "./commands/serve.ts";
import { runTestBotLoop } from "./commands/test_bot.ts";
import { runGraderAgainstState } from "./commands/grade.ts";
import { exportBundle } from "./commands/export.ts";
import { handleDemoCommand } from "./commands/demo.ts";
import { handleInitCommand } from "./commands/init.ts";
import { parseBotInput, parseContext, parseMessage } from "./cli_utils.ts";
import {
  isHelpCommand,
  isKnownCommand,
  parseCliArgs,
  printCommandUsage,
  printShortUsage,
  printUsage,
} from "./cli_args.ts";
import {
  createModelAliasResolver,
  loadProjectConfig,
} from "./project_config.ts";

const logger = console;
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

type ModelCandidate = {
  model: string;
  params?: Record<string, unknown>;
  alias?: string;
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

function mergeParams(
  aliasParams?: Record<string, unknown>,
  baseParams?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (aliasParams && baseParams) {
    return { ...aliasParams, ...baseParams };
  }
  return baseParams ?? aliasParams;
}

async function readVersionFromConfig(
  configPath: string,
): Promise<string | null> {
  try {
    const text = await Deno.readTextFile(configPath);
    const data = parse(text) as { version?: string };
    const version = typeof data.version === "string" ? data.version.trim() : "";
    return version || null;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return null;
    }
    throw err;
  }
}

async function resolveCliVersion(): Promise<string> {
  const envVersion = Deno.env.get("GAMBIT_VERSION");
  if (envVersion) {
    return envVersion.trim() || "unknown";
  }
  const candidates = ["../deno.jsonc", "../deno.json"];
  for (const rel of candidates) {
    const url = new URL(rel, import.meta.url);
    if (url.protocol !== "file:") continue;
    const configPath = path.fromFileUrl(url);
    const version = await readVersionFromConfig(configPath);
    if (version) return version;
  }
  return "unknown";
}

async function loadGambitEnv() {
  const envPath = path.resolve(Deno.cwd(), "gambit", ".env");
  try {
    await loadDotenv({ envPath, export: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }
}

async function main() {
  try {
    await loadGambitEnv();
    const args = parseCliArgs(Deno.args);
    if (args.version) {
      logger.log(await resolveCliVersion());
      return;
    }

    if (args.cmd && args.cmd !== "help" && !isKnownCommand(args.cmd)) {
      logger.error(`Unknown command "${args.cmd}".`);
      logger.error(`Run "gambit help" to see available commands.`);
      Deno.exit(1);
    }

    if (args.help) {
      const helpTarget = args.cmd === "help" ? args.deckPath : args.cmd;
      if (!helpTarget) {
        if (args.verbose) {
          printUsage();
        } else {
          printShortUsage();
        }
        Deno.exit(0);
      }
      if (!isKnownCommand(helpTarget)) {
        logger.error(`Unknown command "${helpTarget}".`);
        logger.error(`Run "gambit help" to see available commands.`);
        Deno.exit(1);
      }
      if (!isHelpCommand(helpTarget)) {
        logger.error(`Help for "${helpTarget}" is not available yet.`);
        logger.error(`Run "gambit help" to see available commands.`);
        Deno.exit(1);
      }
      printCommandUsage(helpTarget);
      Deno.exit(0);
    }

    if (!args.cmd) {
      printShortUsage();
      Deno.exit(1);
    }

    if (args.cmd === "help") {
      if (!args.deckPath) {
        if (args.verbose) {
          printUsage();
        } else {
          printShortUsage();
        }
        return;
      }
      if (!isKnownCommand(args.deckPath)) {
        logger.error(`Unknown command "${args.deckPath}".`);
        logger.error(`Run "gambit help" to see available commands.`);
        Deno.exit(1);
      }
      if (!isHelpCommand(args.deckPath)) {
        logger.error(`Help for "${args.deckPath}" is not available yet.`);
        logger.error(`Run "gambit help" to see available commands.`);
        Deno.exit(1);
      }
      printCommandUsage(args.deckPath);
      return;
    }

    if (args.cmd === "demo") {
      await handleDemoCommand();
      return;
    }

    if (args.cmd === "init") {
      await handleInitCommand(args.deckPath);
      return;
    }

    const deckPath = args.deckPath ?? args.exportDeckPath ?? "";

    if (args.cmd === "repl" && !args.deckPath) {
      printCommandUsage("repl");
      return;
    }

    if (!deckPath && args.cmd !== "grade" && args.cmd !== "export") {
      printUsage();
      Deno.exit(1);
    }

    const configHint = deckPath || args.graderPath || args.testDeckPath ||
      args.exportDeckPath || Deno.cwd();
    let projectConfig: Awaited<ReturnType<typeof loadProjectConfig>> = null;
    try {
      projectConfig = await loadProjectConfig(configHint);
    } catch (err) {
      logger.error(
        `Failed to load gambit.toml: ${(err as Error).message}`,
      );
      Deno.exit(1);
    }
    const modelAliasResolver = createModelAliasResolver(
      projectConfig?.config,
    );
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
        const resolution = modelAliasResolver(entry);
        if (
          resolution.missingAlias &&
          !warnedMissingAliases.has(entry)
        ) {
          logger.warn(
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
                alias: resolution.alias,
              });
            }
          } else if (resolvedModel) {
            candidates.push({
              model: resolvedModel,
              params: mergedParams,
              alias: resolution.alias,
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

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
    const googleApiKey = (Deno.env.get("GOOGLE_API_KEY") ??
      Deno.env.get("GEMINI_API_KEY"))?.trim();
    const openRouterBaseURL = Deno.env.get("OPENROUTER_BASE_URL") ??
      DEFAULT_OPENROUTER_BASE_URL;
    const ollamaBaseURL = Deno.env.get("OLLAMA_BASE_URL") ?? undefined;
    const googleBaseURL = Deno.env.get("GOOGLE_BASE_URL") ??
      Deno.env.get("GEMINI_BASE_URL") ??
      undefined;

    const fallbackProviderRaw = projectConfig?.config?.providers?.fallback;
    let fallbackProvider:
      | "openrouter"
      | "ollama"
      | "google"
      | null
      | undefined = undefined;
    if (typeof fallbackProviderRaw === "string") {
      const normalized = fallbackProviderRaw.trim().toLowerCase();
      if (normalized === "none") {
        fallbackProvider = null;
      } else if (
        normalized === "openrouter" || normalized === "ollama" ||
        normalized === "google"
      ) {
        fallbackProvider = normalized as "openrouter" | "ollama" | "google";
      } else if (normalized.length > 0) {
        logger.warn(
          `[gambit] Unknown providers.fallback "${fallbackProviderRaw}" in gambit.toml; using default fallback.`,
        );
      }
    }

    const effectiveFallbackProvider = fallbackProvider === undefined
      ? "openrouter"
      : fallbackProvider;

    if (args.cmd === "grade") {
      const graderPath = args.graderPath ?? deckPath;
      if (!graderPath) {
        logger.error("grade requires a grader deck path.");
        Deno.exit(1);
      }
      if (!args.statePath) {
        logger.error("grade requires --state <file>.");
        Deno.exit(1);
      }
      try {
        await Deno.stat(graderPath);
      } catch (err) {
        logger.error(
          `Grader deck not found at ${graderPath}: ${(err as Error).message}`,
        );
        Deno.exit(1);
      }
    } else if (args.cmd === "export") {
      if (!args.statePath) {
        logger.error("export requires --state <file>.");
        Deno.exit(1);
      }
      if (!args.outPath) {
        logger.error("export requires --out <file>.");
        Deno.exit(1);
      }
    }

    if (args.cmd === "export") {
      const outPath = await exportBundle({
        statePath: args.statePath ?? "",
        outPath: args.outPath ?? "",
        deckPath: deckPath || undefined,
      });
      logger.log(`Exported bundle to ${outPath}`);
      return;
    }

    if (args.cmd === "check") {
      if (!deckPath) {
        logger.error("check requires a deck path.");
        Deno.exit(1);
      }
      await handleCheckCommand({
        deckPath,
        modelResolver: modelAliasResolver,
        fallbackProvider,
        checkOnline: args.online,
        openRouterApiKey: openRouterApiKey ?? undefined,
        googleApiKey: googleApiKey ?? undefined,
        ollamaBaseURL,
      });
      return;
    }

    const chatFallback = Deno.env.get("GAMBIT_CHAT_FALLBACK") === "1";
    const responsesMode = args.responses ||
      (!chatFallback && Deno.env.get("GAMBIT_RESPONSES_MODE") !== "0");
    const openRouterProvider = openRouterApiKey
      ? createOpenRouterProvider({
        apiKey: openRouterApiKey,
        baseURL: openRouterBaseURL ?? undefined,
        enableResponses: (args.responses || !chatFallback) &&
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

    const providerRouter = createProviderRouter({
      providers: {
        openrouter: openRouterProvider,
        ollama: ollamaProvider,
        google: googleProvider,
      },
      defaultProvider: fallbackProvider,
      fallbackToDefaultOnMissing: ["google"],
    });

    const ollamaPrefix = OLLAMA_PREFIX;
    const providerMatchers = createProviderMatchers(effectiveFallbackProvider);
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
        isAvailable: async (model, opts) => {
          const trimmed = model.slice(ollamaPrefix.length);
          if (!trimmed) {
            return { available: false, reason: "missing Ollama model name" };
          }
          if (opts.allowPull) {
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
        isAvailable: (_model, _opts) =>
          Promise.resolve(
            googleApiKey
              ? { available: true }
              : (effectiveFallbackProvider === "openrouter" && openRouterApiKey)
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
        isAvailable: (_model, _opts) =>
          Promise.resolve(
            openRouterApiKey ? { available: true } : {
              available: false,
              reason: "OPENROUTER_API_KEY is not set",
            },
          ),
      },
    ];
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
        const provider = providerCapabilities.find((cap) =>
          cap.matches(candidate.model)
        );
        const availability = provider
          ? await provider.isAvailable(candidate.model, { allowPull })
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
        const label = provider ? provider.name : "unknown";
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
    const shouldResolveModel = (
      model: string | Array<string>,
    ): boolean => {
      if (Array.isArray(model)) return true;
      const resolution = modelAliasResolver(model);
      return Boolean(resolution.applied || resolution.missingAlias);
    };
    const provider: import("@bolt-foundry/gambit-core").ModelProvider = {
      resolveModel: async (input) =>
        await resolveModelSelection(
          input.model,
          input.params,
          input.deckPath,
        ),
      responses: async (input: {
        request: import("@bolt-foundry/gambit-core").CreateResponseRequest;
        state?: import("@bolt-foundry/gambit-core").SavedState;
        onStreamEvent?: (
          event: import("@bolt-foundry/gambit-core").ResponseEvent,
        ) => void;
      }) => {
        const applied = shouldResolveModel(input.request.model)
          ? await resolveModelSelection(
            input.request.model,
            input.request.params,
          )
          : { model: input.request.model, params: input.request.params };
        const request = {
          ...input.request,
          model: applied.model ?? input.request.model,
          params: applied.params,
        };
        if (!request.model) {
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
        messages: Array<import("@bolt-foundry/gambit-core").ModelMessage>;
        tools?: Array<import("@bolt-foundry/gambit-core").ToolDefinition>;
        stream?: boolean;
        state?: import("@bolt-foundry/gambit-core").SavedState;
        onStreamText?: (chunk: string) => void;
        params?: Record<string, unknown>;
      }) => {
        const applied = shouldResolveModel(input.model)
          ? await resolveModelSelection(input.model, input.params)
          : { model: input.model, params: input.params };
        const request = {
          ...input,
          model: applied.model ?? input.model,
          params: applied.params,
        };
        if (!request.model) {
          throw new Error("Model is required.");
        }
        const selection = providerRouter.resolve({ model: request.model });
        return await selection.provider.chat({
          ...request,
          model: selection.model,
        });
      },
    };

    const tracerFns: Array<
      (
        event: import("@bolt-foundry/gambit-core").TraceEvent,
      ) => void
    > = [];
    if (args.trace) tracerFns.push(makeJsonlTracer(args.trace));
    if (args.verbose) tracerFns.push(makeConsoleTracer());
    const tracer = tracerFns.length
      ? (
        event: import("@bolt-foundry/gambit-core").TraceEvent,
      ) => tracerFns.forEach((fn) => fn(event))
      : undefined;

    if (args.cmd === "repl") {
      await startTui({
        deckPath,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        trace: tracer,
        verbose: args.verbose,
        responsesMode,
        initialContext: args.context !== undefined
          ? parseContext(args.context)
          : undefined,
        contextProvided: args.contextProvided,
        initialMessage: parseMessage(args.message),
      });
      return;
    }

    if (args.cmd === "serve") {
      await handleServeCommand({
        deckPath,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        context: parseContext(args.context),
        contextProvided: args.contextProvided,
        port: args.port,
        verbose: args.verbose,
        watch: args.watch,
        bundle: args.bundle,
        sourcemap: args.sourcemap,
        platform: args.platform,
        responsesMode,
      });
      return;
    }

    if (args.cmd === "test-bot") {
      if (!deckPath) {
        logger.error("test-bot requires a root deck path.");
        Deno.exit(1);
      }
      if (!args.testDeckPath) {
        logger.error("test-bot requires --test-deck <persona deck path>.");
        Deno.exit(1);
      }
      const maxTurns = args.maxTurns ?? 12;
      const statePath = await runTestBotLoop({
        rootDeckPath: deckPath,
        botDeckPath: args.testDeckPath,
        context: parseContext(args.context),
        contextProvided: args.contextProvided,
        initialUserMessage: parseMessage(args.message),
        botInput: parseBotInput(args.botInput),
        maxTurns,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        trace: tracer,
        verbose: args.verbose,
        statePath: args.statePath,
        responsesMode,
      });
      logger.log(`Test bot session saved to ${statePath}`);
      if (args.gradePaths && args.gradePaths.length > 0) {
        for (const graderPath of args.gradePaths) {
          await runGraderAgainstState({
            statePath,
            graderPath,
            model: args.model,
            modelForce: args.modelForce,
            modelProvider: provider,
            trace: tracer,
            responsesMode,
          });
        }
      }
      return;
    }

    if (args.cmd === "grade") {
      const graderPath = args.graderPath ?? deckPath;
      if (!graderPath) {
        logger.error("grade requires a grader deck path.");
        Deno.exit(1);
      }
      if (!args.statePath) {
        logger.error("grade requires --state <file>.");
        Deno.exit(1);
      }
      await runGraderAgainstState({
        statePath: args.statePath,
        graderPath,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        trace: tracer,
        responsesMode,
      });
      return;
    }

    await handleRunCommand({
      deckPath,
      context: parseContext(args.context),
      contextProvided: args.contextProvided,
      message: parseMessage(args.message),
      modelProvider: provider,
      model: args.model,
      modelForce: args.modelForce,
      trace: tracer,
      stream: args.stream,
      statePath: args.statePath,
      responsesMode,
    });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
