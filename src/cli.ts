#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
import { createOpenRouterProvider } from "./providers/openrouter.ts";
import { runDeck } from "./runtime.ts";
import { makeJsonlTracer } from "./trace.ts";

type Args = {
  cmd: "run";
  deckPath: string;
  input?: string;
  model?: string;
  modelForce?: string;
  trace?: string;
  stream?: boolean;
};

function parseArgs(argv: string[]): Args {
  if (argv.length === 0) {
    throw new Error(
      "Usage: gambit run <deck.(ts|md)> [--input <json|string>] [--model <id>] [--model-force <id>] [--trace file] [--stream]",
    );
  }
  const [cmd, deckPath, ...rest] = argv;
  if (cmd !== "run") throw new Error("Only `run` is supported");
  if (!deckPath) throw new Error("Missing deck path");

  let input: string | undefined;
  let model: string | undefined;
  let modelForce: string | undefined;
  let trace: string | undefined;
  let stream = false;
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
    }
  }

  return { cmd: "run", deckPath, input, model, modelForce, trace, stream };
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

    const tracer = args.trace ? makeJsonlTracer(args.trace) : undefined;

    const result = await runDeck({
      path: args.deckPath,
      input: parseInput(args.input),
      modelProvider: provider,
      isRoot: true,
      defaultModel: args.model,
      modelOverride: args.modelForce,
      trace: tracer,
      stream: args.stream,
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
