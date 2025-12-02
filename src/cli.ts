#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
import * as path from "@std/path";
import { parseArgs } from "jsr:@std/cli@1.0.7/parse-args";
import { createOpenRouterProvider } from "./providers/openrouter.ts";
import { runDeck } from "./runtime.ts";
import { startWebSocketSimulator } from "./server.ts";
import { makeConsoleTracer, makeJsonlTracer } from "./trace.ts";
import { startRepl } from "./repl.ts";
import { loadState, saveState } from "./state.ts";

type Args = {
  cmd: "run" | "repl" | "serve";
  deckPath?: string;
  input?: string;
  model?: string;
  modelForce?: string;
  trace?: string;
  stream?: boolean;
  statePath?: string;
  verbose?: boolean;
  port?: number;
  userFirst?: boolean;
  help?: boolean;
};

const DEFAULT_REPL_DECK_URL = new URL(
  "./decks/gambit-assistant.deck.md",
  import.meta.url,
);

function resolveDefaultReplDeckPath(): string | null {
  if (DEFAULT_REPL_DECK_URL.protocol !== "file:") {
    console.error(
      "Default REPL deck is unavailable when running from a remote URL. " +
        "Pass a deck path (e.g. examples/hello_world/root.deck.ts) or run from a local checkout.",
    );
    return null;
  }
  return path.fromFileUrl(DEFAULT_REPL_DECK_URL);
}

function parseCliArgs(argv: string[]): Args {
  const parsed = parseArgs(argv, {
    boolean: ["stream", "verbose", "help", "user-first"],
    string: ["input", "model", "model-force", "trace", "state", "port"],
    alias: {
      help: "h",
    },
    default: {
      stream: false,
      verbose: false,
      "user-first": false,
    },
  });

  const [cmdRaw, deckPathRaw] = parsed._;
  const cmd = cmdRaw as Args["cmd"];
  const deckPath = deckPathRaw as string | undefined;

  return {
    cmd,
    deckPath,
    input: parsed.input as string | undefined,
    model: parsed.model as string | undefined,
    modelForce: parsed["model-force"] as string | undefined,
    trace: parsed.trace as string | undefined,
    stream: Boolean(parsed.stream),
    statePath: parsed.state as string | undefined,
    verbose: Boolean(parsed.verbose),
    port: parsed.port ? Number(parsed.port) : undefined,
    userFirst: Boolean(parsed["user-first"]),
    help: Boolean(parsed.help),
  };
}

function printUsage() {
  console.log(
    `Usage:
  gambit run <deck.(ts|md)> [--input <json|string>] [--model <id>] [--model-force <id>] [--trace <file>] [--state <file>] [--stream] [--verbose]
  gambit repl [<deck.(ts|md)>] [--model <id>] [--model-force <id>] [--verbose]
  gambit serve <deck.(ts|md)> [--model <id>] [--model-force <id>] [--port <n>] [--verbose]

Flags:
  --input <json|string>   Input payload (run only)
  --model <id>            Default model id
  --model-force <id>      Override model id
  --trace <file>          Write trace events to file (JSONL)
  --state <file>          Load and persist state (run only)
  --stream                Enable streaming responses
  --verbose               Print trace events to console
  --port <n>              Port for serve (default: 8000)
  --user-first            Send the user message first (default: assistant starts)
  -h, --help              Show this help
  repl default deck       src/decks/gambit-assistant.deck.md
`,
  );
}

function parseInput(raw?: string): unknown {
  if (raw === undefined) return "";
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
      console.error("Only `run`, `repl`, and `serve` are supported");
      printUsage();
      Deno.exit(1);
    }

    const deckPath = args.deckPath ??
      (args.cmd === "repl" ? resolveDefaultReplDeckPath() ?? "" : "");

    if (!deckPath) {
      printUsage();
      Deno.exit(1);
    }

    if (!args.deckPath && args.cmd === "repl") {
      try {
        await Deno.stat(deckPath);
      } catch {
        console.error(
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
        userFirst: args.userFirst,
      });
      return;
    }

    if (args.cmd === "serve") {
      const server = startWebSocketSimulator({
        deckPath,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        port: args.port ?? 8000,
        verbose: args.verbose,
        userFirst: args.userFirst,
      });
      await server.finished;
      return;
    }

    const state = args.statePath ? loadState(args.statePath) : undefined;
    const onStateUpdate = args.statePath
      ? (s: import("./state.ts").SavedState) => saveState(args.statePath!, s)
      : undefined;

    const result = await runDeck({
      path: deckPath,
      input: parseInput(args.input),
      modelProvider: provider,
      isRoot: true,
      defaultModel: args.model,
      modelOverride: args.modelForce,
      trace: tracer,
      stream: args.stream,
      state,
      onStateUpdate,
      userFirst: args.userFirst,
    });

    if (typeof result === "string") {
      console.log(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
