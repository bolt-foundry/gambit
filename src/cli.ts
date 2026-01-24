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
import { createOllamaProvider } from "./providers/ollama.ts";
import { createOpenRouterProvider } from "./providers/openrouter.ts";
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

const logger = console;
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

type OllamaTagsResponse = {
  models?: Array<{ name?: string }>;
};

async function ensureOllamaModel(
  model: string,
  baseURL: string | undefined,
) {
  const origin = new URL(baseURL ?? DEFAULT_OLLAMA_BASE_URL).origin;
  const tagsUrl = new URL("/api/tags", origin);
  const tagsResponse = await fetch(tagsUrl);
  if (!tagsResponse.ok) {
    throw new Error(
      `Failed to list Ollama models (${tagsResponse.status} ${tagsResponse.statusText}).`,
    );
  }
  const tags = (await tagsResponse.json()) as OllamaTagsResponse;
  const models = tags.models ?? [];
  const modelNames = new Set(
    models
      .map((entry) => entry.name?.trim())
      .filter((name): name is string => Boolean(name)),
  );
  if (modelNames.has(model)) {
    return;
  }

  logger.log(`Ollama model "${model}" not found; pulling from Ollama...`);
  const pullUrl = new URL("/api/pull", origin);
  const pullResponse = await fetch(pullUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model }),
  });
  if (!pullResponse.ok || !pullResponse.body) {
    throw new Error(
      `Failed to pull Ollama model "${model}" (${pullResponse.status} ${pullResponse.statusText}).`,
    );
  }

  const decoder = new TextDecoder();
  const reader = pullResponse.body.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { status?: string; error?: string };
        if (event.error) {
          throw new Error(event.error);
        }
        if (event.status) {
          logger.log(`[ollama] ${event.status}`);
        }
      } catch (err) {
        throw new Error(
          `Failed to parse Ollama pull response: ${(err as Error).message}`,
        );
      }
    }
  }
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
        openRouterApiKey: Deno.env.get("OPENROUTER_API_KEY") ?? undefined,
        openRouterBaseURL: Deno.env.get("OPENROUTER_BASE_URL") ?? undefined,
        ollamaApiKey: Deno.env.get("OLLAMA_API_KEY") ?? undefined,
        ollamaBaseURL: Deno.env.get("OLLAMA_BASE_URL") ?? undefined,
      });
      return;
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
    const chatFallback = Deno.env.get("GAMBIT_CHAT_FALLBACK") === "1";
    const responsesMode = args.responses ||
      (!chatFallback && Deno.env.get("GAMBIT_RESPONSES_MODE") !== "0");
    const openRouterProvider = apiKey
      ? createOpenRouterProvider({
        apiKey,
        baseURL: Deno.env.get("OPENROUTER_BASE_URL") ?? undefined,
        enableResponses: (args.responses || !chatFallback) &&
          Deno.env.get("GAMBIT_OPENROUTER_RESPONSES") !== "0",
      })
      : null;
    const ollamaBaseURL = Deno.env.get("OLLAMA_BASE_URL") ?? undefined;
    const ollamaProvider = createOllamaProvider({
      apiKey: Deno.env.get("OLLAMA_API_KEY")?.trim() || undefined,
      baseURL: ollamaBaseURL,
    });
    const ollamaPrefix = "ollama/";
    const ollamaModels = [
      args.model ?? undefined,
      args.modelForce ?? undefined,
    ]
      .filter((model): model is string => Boolean(model))
      .filter((model) => model.startsWith(ollamaPrefix))
      .map((model) => model.slice(ollamaPrefix.length));
    for (const model of new Set(ollamaModels)) {
      await ensureOllamaModel(model, ollamaBaseURL);
    }
    const provider: import("@bolt-foundry/gambit-core").ModelProvider = {
      responses: async (input: {
        request: import("@bolt-foundry/gambit-core").CreateResponseRequest;
        state?: import("@bolt-foundry/gambit-core").SavedState;
        onStreamEvent?: (
          event: import("@bolt-foundry/gambit-core").ResponseEvent,
        ) => void;
      }) => {
        if (input.request.model.startsWith(ollamaPrefix)) {
          const trimmedModel = input.request.model.slice(ollamaPrefix.length);
          const ollamaResponses = ollamaProvider.responses;
          if (!ollamaResponses) {
            throw new Error("Ollama responses are not configured.");
          }
          return await ollamaResponses({
            ...input,
            request: {
              ...input.request,
              model: trimmedModel,
            },
          });
        }
        if (!openRouterProvider?.responses) {
          throw new Error(
            "OPENROUTER_API_KEY is required for non-ollama models.",
          );
        }
        return await openRouterProvider.responses(input);
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
        if (input.model.startsWith(ollamaPrefix)) {
          const model = input.model.slice(ollamaPrefix.length);
          return await ollamaProvider.chat({ ...input, model });
        }
        if (!openRouterProvider) {
          throw new Error(
            "OPENROUTER_API_KEY is required for non-ollama models.",
          );
        }
        return await openRouterProvider.chat(input);
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
