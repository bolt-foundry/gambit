#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
import * as path from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import { createOpenRouterProvider } from "./providers/openrouter.ts";
import { runDeck } from "./runtime.ts";
import { startWebSocketSimulator } from "./server.ts";
import { makeConsoleTracer, makeJsonlTracer } from "./trace.ts";
import { startRepl } from "./repl.ts";
import { loadState, saveState } from "./state.ts";

const logger = console;

type Args = {
  cmd: "run" | "repl" | "serve";
  deckPath?: string;
  example?: string;
  init?: string;
  message?: string;
  initProvided: boolean;
  model?: string;
  modelForce?: string;
  trace?: string;
  stream?: boolean;
  statePath?: string;
  verbose?: boolean;
  port?: number;
  watch?: boolean;
  help?: boolean;
};

const DEFAULT_REPL_DECK_URL = new URL(
  "./decks/gambit-assistant.deck.md",
  import.meta.url,
);

function resolveDefaultReplDeckPath(): string | null {
  if (DEFAULT_REPL_DECK_URL.protocol !== "file:") {
    logger.error(
      "Default REPL deck is unavailable when running from a remote URL. " +
        "Pass a deck path (e.g. src/decks/gambit-assistant.deck.md) or run from a local checkout.",
    );
    return null;
  }
  return path.fromFileUrl(DEFAULT_REPL_DECK_URL);
}

function resolveExamplePath(example: string): string {
  const examplesUrl = new URL("../examples/", import.meta.url);
  if (examplesUrl.protocol !== "file:") {
    throw new Error(
      "--example is unavailable when running from a remote URL; pass a deck path instead.",
    );
  }
  const baseDir = path.fromFileUrl(examplesUrl);
  const candidate = path.resolve(baseDir, example);
  const rel = path.relative(baseDir, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Example path must stay within examples/: ${example}`);
  }
  return candidate;
}

function parsePortValue(value: unknown, label = "port"): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return n;
}

function parseCliArgs(argv: Array<string>): Args {
  const parsed = parseArgs(argv, {
    boolean: ["stream", "verbose", "help", "watch"],
    string: [
      "example",
      "init",
      "message",
      "model",
      "model-force",
      "trace",
      "state",
      "port",
    ],
    alias: {
      help: "h",
    },
    default: {
      stream: false,
      verbose: false,
    },
  });

  if ((parsed as { input?: unknown }).input !== undefined) {
    throw new Error("`--input` has been removed; use `--init` instead.");
  }

  const [cmdRaw, deckPathRaw] = parsed._;
  const cmd = cmdRaw as Args["cmd"];
  const deckPath = deckPathRaw as string | undefined;

  return {
    cmd,
    deckPath,
    example: parsed.example as string | undefined,
    init: parsed.init as string | undefined,
    initProvided: parsed.init !== undefined,
    message: parsed.message as string | undefined,
    model: parsed.model as string | undefined,
    modelForce: parsed["model-force"] as string | undefined,
    trace: parsed.trace as string | undefined,
    stream: Boolean(parsed.stream),
    statePath: parsed.state as string | undefined,
    verbose: Boolean(parsed.verbose),
    port: parsePortValue(parsed.port),
    watch: Boolean(parsed.watch),
    help: Boolean(parsed.help),
  };
}

function printUsage() {
  logger.log(
    `Usage:
  gambit run [<deck.(ts|md)>] [--example <examples/...>] [--init <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--trace <file>] [--state <file>] [--stream] [--verbose]
  gambit repl [<deck.(ts|md)>] [--example <examples/...>] [--init <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--verbose]
  gambit serve [<deck.(ts|md)>] [--example <examples/...>] [--model <id>] [--model-force <id>] [--port <n>] [--verbose] [--watch]

Flags:
  --init <json|string>    Init payload (when provided, sent via gambit_init)
  --message <json|string> Initial user message (sent before assistant speaks)
  --model <id>            Default model id
  --model-force <id>      Override model id
  --trace <file>          Write trace events to file (JSONL)
  --state <file>          Load and persist state (run only)
  --stream                Enable streaming responses
  --verbose               Print trace events to console
  --port <n>              Port for serve (default: 8000)
  --watch                 Restart server on file changes (serve)
  --example <path>        Path relative to examples/ (e.g. hello_world.deck.md)
  -h, --help              Show this help
  repl default deck       src/decks/gambit-assistant.deck.md
`,
  );
}

function parseInit(raw?: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseMessage(raw?: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function main() {
  try {
    const args = parseCliArgs(Deno.args);
    if (args.help || !args.cmd) {
      printUsage();
      Deno.exit(args.cmd ? 0 : 1);
    }
    if (!["run", "repl", "serve"].includes(args.cmd)) {
      logger.error("Only `run`, `repl`, and `serve` are supported");
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
        (args.cmd === "repl" ? resolveDefaultReplDeckPath() ?? "" : "");

    if (!deckPath) {
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
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is required");
    }
    const provider = createOpenRouterProvider({
      apiKey,
      baseURL: Deno.env.get("OPENROUTER_BASE_URL") ?? undefined,
    });

    const tracerFns: Array<(event: import("./types.ts").TraceEvent) => void> =
      [];
    if (args.trace) tracerFns.push(makeJsonlTracer(args.trace));
    if (args.verbose) tracerFns.push(makeConsoleTracer());
    const tracer = tracerFns.length
      ? (event: import("./types.ts").TraceEvent) =>
        tracerFns.forEach((fn) => fn(event))
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
      const envPort = parsePortValue(Deno.env.get("PORT"), "PORT");
      const port = args.port ?? envPort ?? 8000;
      const startServer = () =>
        startWebSocketSimulator({
          deckPath,
          model: args.model,
          modelForce: args.modelForce,
          modelProvider: provider,
          port,
          verbose: args.verbose,
        });

      if (!args.watch) {
        const server = startServer();
        await server.finished;
        return;
      }

      const watchTargets = Array.from(
        new Set([
          path.dirname(deckPath),
          path.resolve("src"),
        ]),
      ).filter((p) => {
        try {
          Deno.statSync(p);
          return true;
        } catch {
          return false;
        }
      });

      if (!watchTargets.length) {
        throw new Error("No watchable paths found for --watch");
      }

      logger.log(
        `[serve] watching for changes in ${
          watchTargets.join(", ")
        }; port=${port}`,
      );

      let server = startServer();
      const watcher = Deno.watchFs(watchTargets, { recursive: true });
      const shouldIgnore = (p: string) =>
        p.includes(".git") ||
        p.endsWith("~") ||
        p.includes(".swp") ||
        p.includes(".tmp");

      const restart = async (reason: string) => {
        try {
          await server.shutdown();
        } catch {
          // ignore
        }
        await server.finished.catch(() => {});
        logger.log(`[serve] restarting (${reason})...`);
        server = startServer();
      };

      try {
        for await (const event of watcher) {
          const changed = event.paths.find((p) => !shouldIgnore(p));
          if (!changed) continue;
          await restart(`${event.kind}: ${path.basename(changed)}`);
        }
      } finally {
        try {
          watcher.close();
        } catch {
          // ignore
        }
        try {
          await server.shutdown();
        } catch {
          // ignore
        }
      }
      return;
    }

    const state = args.statePath ? loadState(args.statePath) : undefined;
    const onStateUpdate = args.statePath
      ? (s: import("./state.ts").SavedState) => saveState(args.statePath!, s)
      : undefined;

    const result = await runDeck({
      path: deckPath,
      input: parseInit(args.init),
      inputProvided: args.initProvided,
      initialUserMessage: parseMessage(args.message),
      modelProvider: provider,
      isRoot: true,
      defaultModel: args.model,
      modelOverride: args.modelForce,
      trace: tracer,
      stream: args.stream,
      state,
      onStateUpdate,
    });

    if (typeof result === "string") {
      logger.log(result);
    } else {
      logger.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
