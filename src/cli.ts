#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/**
 * Gambit CLI entrypoint for running decks, REPLs, simulators, and tooling.
 *
 * @module
 */
import {
  createGeminiProvider,
  createOpenRouterProvider,
  ModelProvider,
} from "@bolt-foundry/gambit-core";
import { parse } from "@std/jsonc";
import * as path from "@std/path";
import { load as loadDotenv } from "@std/dotenv";
import { makeConsoleTracer, makeJsonlTracer } from "./trace.ts";
import { startTui } from "./tui.ts";
import { handleRunCommand } from "./commands/run.ts";
import { handleServeCommand } from "./commands/serve.ts";
import { runTestBotLoop } from "./commands/test_bot.ts";
import { runGraderAgainstState } from "./commands/grade.ts";
import { exportBundle } from "./commands/export.ts";
import { handleInitCommand } from "./commands/init.ts";
import { parseBotInput, parseInit, parseMessage } from "./cli_utils.ts";
import {
  isHelpCommand,
  isKnownCommand,
  parseCliArgs,
  printCommandUsage,
  printShortUsage,
  printUsage,
} from "./cli_args.ts";

const logger = console;

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

    if (args.cmd === "init") {
      await handleInitCommand();
      return;
    }

    const deckPath = args.deckPath ?? args.exportDeckPath ?? "";

    if (args.cmd === "repl" && !args.deckPath) {
      printCommandUsage("repl");
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

    let provider: ModelProvider;
    const model = args.model ?? "";

    if (model.startsWith("gemini") || model.startsWith("google")) {
      const apiKey = Deno.env.get("GOOGLE_API_KEY") ??
        Deno.env.get("GEMINI_API_KEY");
      if (!apiKey) {
        throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is required for Gemini models");
      }
      provider = createGeminiProvider({ apiKey });
    } else {
      const apiKey = Deno.env.get("OPENROUTER_API_KEY");
      if (!apiKey) {
        throw new Error(
          "OPENROUTER_API_KEY is required for this model. For Gemini, use GOOGLE_API_KEY.",
        );
      }
      provider = createOpenRouterProvider({
        apiKey,
        baseURL: Deno.env.get("OPENROUTER_BASE_URL") ?? undefined,
      });
    }


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
        initialInit: args.init !== undefined ? parseInit(args.init) : undefined,
        initProvided: args.initProvided,
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
        port: args.port,
        verbose: args.verbose,
        watch: args.watch,
        bundle: args.bundle,
        sourcemap: args.sourcemap,
        platform: args.platform,
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
        init: parseInit(args.init),
        initProvided: args.initProvided,
        initialUserMessage: parseMessage(args.message),
        botInput: parseBotInput(args.botInput),
        maxTurns,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        trace: tracer,
        verbose: args.verbose,
        statePath: args.statePath,
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
      });
      return;
    }

    await handleRunCommand({
      deckPath,
      init: parseInit(args.init),
      initProvided: args.initProvided,
      message: parseMessage(args.message),
      modelProvider: provider,
      model: args.model,
      modelForce: args.modelForce,
      trace: tracer,
      stream: args.stream,
      statePath: args.statePath,
    });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
