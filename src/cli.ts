#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/**
 * Gambit CLI entrypoint for running decks, REPLs, simulators, and tooling.
 *
 * @module
 */
import { createOpenRouterProvider } from "@bolt-foundry/gambit-core";
import { makeConsoleTracer, makeJsonlTracer } from "./trace.ts";
import { startRepl } from "./repl.tsx";
import { handleRunCommand } from "./commands/run.ts";
import { handleServeCommand } from "./commands/serve.ts";
import { runTestBotLoop } from "./commands/test_bot.ts";
import { runGraderAgainstState } from "./commands/grade.ts";
import { exportBundle } from "./commands/export.ts";
import { parseBotInput, parseInit, parseMessage } from "./cli_utils.ts";
import {
  parseCliArgs,
  printUsage,
  resolveDefaultReplDeckPath,
  resolveExamplePath,
} from "./cli_args.ts";

const logger = console;

async function main() {
  try {
    const args = parseCliArgs(Deno.args);
    if (args.help || !args.cmd) {
      printUsage();
      Deno.exit(args.cmd ? 0 : 1);
    }
    if (
      !["run", "repl", "serve", "test-bot", "grade", "export"].includes(
        args.cmd,
      )
    ) {
      logger.error(
        "Only `run`, `repl`, `serve`, `test-bot`, `grade`, and `export` are supported",
      );
      printUsage();
      Deno.exit(1);
    }

    if (args.example && args.deckPath) {
      logger.error("Provide either a deck path or --example, not both.");
      Deno.exit(1);
    }

    const deckPath = args.example
      ? resolveExamplePath(args.example)
      : args.deckPath ??
        args.exportDeckPath ??
        (args.cmd === "repl" ? resolveDefaultReplDeckPath() ?? "" : "");

    if (!deckPath && args.cmd !== "grade" && args.cmd !== "export") {
      printUsage();
      Deno.exit(1);
    }

    if (args.example) {
      try {
        await Deno.stat(deckPath);
      } catch (err) {
        logger.error(
          `Example not found at ${deckPath}: ${(err as Error).message}`,
        );
        Deno.exit(1);
      }
    } else if (!args.deckPath && args.cmd === "repl") {
      try {
        await Deno.stat(deckPath);
      } catch {
        logger.error(
          `Default REPL deck not found at ${deckPath}. Pass a deck path explicitly.`,
        );
        Deno.exit(1);
      }
    } else if (args.cmd === "grade") {
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

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is required");
    }
    const provider = createOpenRouterProvider({
      apiKey,
      baseURL: Deno.env.get("OPENROUTER_BASE_URL") ?? undefined,
    });

    const tracerFns: Array<
      (
        event: import("@bolt-foundry/gambit-core/internal/types").TraceEvent,
      ) => void
    > = [];
    if (args.trace) tracerFns.push(makeJsonlTracer(args.trace));
    if (args.verbose) tracerFns.push(makeConsoleTracer());
    const tracer = tracerFns.length
      ? (
        event: import("@bolt-foundry/gambit-core/internal/types").TraceEvent,
      ) => tracerFns.forEach((fn) => fn(event))
      : undefined;

    if (args.cmd === "repl") {
      await startRepl({
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
