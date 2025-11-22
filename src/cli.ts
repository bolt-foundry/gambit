#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
import { createOpenRouterProvider } from "./providers/openrouter.ts";
import { runDeck } from "./runtime.ts";
import { makeConsoleTracer, makeJsonlTracer } from "./trace.ts";
import { startRepl } from "./repl.ts";
import { loadState, saveState } from "./state.ts";

type Args = {
  cmd: "run" | "repl";
  deckPath: string;
  input?: string;
  model?: string;
  modelForce?: string;
  trace?: string;
  stream?: boolean;
  statePath?: string;
  verbose?: boolean;
};

function parseArgs(argv: string[]): Args {
  if (argv.length === 0) {
    throw new Error(
      "Usage: gambit run <deck.(ts|md)> [--input <json|string>] [--model <id>] [--model-force <id>] [--trace file] [--state file] [--stream] [--verbose]\n       gambit repl <deck.(ts|md)> [--model <id>] [--model-force <id>] [--verbose]",
    );
  }
  const [cmd, deckPath, ...rest] = argv;
  if (cmd !== "run" && cmd !== "repl") {
    throw new Error("Only `run` and `repl` are supported");
  }
  if (!deckPath) throw new Error("Missing deck path");

  let input: string | undefined;
  let model: string | undefined;
  let modelForce: string | undefined;
  let trace: string | undefined;
  let stream = false;
  let statePath: string | undefined;
  let verbose = false;
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === "--input") {
      input = rest[++i];
    } else if (token === "--model") {
      model = rest[++i];
    } else if (token === "--model-force") {
      modelForce = rest[++i];
    } else if (token === "--trace") {
      trace = rest[++i];
    } else if (token === "--stream") {
      stream = true;
    } else if (token === "--state") {
      statePath = rest[++i];
    } else if (token === "--verbose") {
      verbose = true;
    }
  }

  return {
    cmd,
    deckPath,
    input,
    model,
    modelForce,
    trace,
    stream,
    statePath,
    verbose,
  };
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
    const args = parseArgs(Deno.args);
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is required");
    }
    const provider = createOpenRouterProvider({
      apiKey,
      baseURL: Deno.env.get("OPENROUTER_BASE_URL") ?? undefined,
    });

    const tracerFns: Array<(event: import("./types.ts").TraceEvent) => void> = [];
    if (args.trace) tracerFns.push(makeJsonlTracer(args.trace));
    if (args.verbose) tracerFns.push(makeConsoleTracer());
    const tracer = tracerFns.length
      ? (event: import("./types.ts").TraceEvent) => tracerFns.forEach((fn) => fn(event))
      : undefined;

    if (args.cmd === "repl") {
      await startRepl({
        deckPath: args.deckPath,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        trace: tracer,
        verbose: args.verbose,
      });
      return;
    }

    const state = args.statePath ? loadState(args.statePath) : undefined;
    const onStateUpdate = args.statePath
      ? (s: import("./state.ts").SavedState) => saveState(args.statePath!, s)
      : undefined;

    const result = await runDeck({
      path: args.deckPath,
      input: parseInput(args.input),
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
