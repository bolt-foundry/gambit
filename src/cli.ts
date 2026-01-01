#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
import * as path from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import type { ZodTypeAny } from "zod";
import { createOpenRouterProvider } from "./providers/openrouter.ts";
import { isGambitEndSignal, runDeck } from "./runtime.ts";
import { startWebSocketSimulator } from "./server.ts";
import { makeConsoleTracer, makeJsonlTracer } from "./trace.ts";
import { startRepl } from "./repl.ts";
import { loadDeck } from "./loader.ts";
import { loadState, saveState } from "./state.ts";
import type { ModelProvider } from "./types.ts";

const logger = console;

type Args = {
  cmd: "run" | "repl" | "serve" | "test-bot" | "grade";
  deckPath?: string;
  example?: string;
  testDeckPath?: string;
  graderPath?: string;
  gradePaths?: Array<string>;
  botInput?: string;
  maxTurns?: number;
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
  bundle?: boolean;
  sourcemap?: boolean;
  platform?: string;
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
    boolean: [
      "stream",
      "verbose",
      "help",
      "watch",
      "bundle",
      "no-bundle",
      "sourcemap",
    ],
    string: [
      "example",
      "init",
      "message",
      "test-deck",
      "grade",
      "grader",
      "bot-input",
      "max-turns",
      "model",
      "model-force",
      "platform",
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
  const hasBundleFlag = argv.includes("--bundle");
  const hasNoBundleFlag = argv.includes("--no-bundle");
  if (hasBundleFlag && hasNoBundleFlag) {
    throw new Error("Use either --bundle or --no-bundle, not both.");
  }
  const hasSourceMapFlag = argv.includes("--sourcemap");
  const hasNoSourceMapFlag = argv.includes("--no-sourcemap");
  if (hasSourceMapFlag && hasNoSourceMapFlag) {
    throw new Error("Use either --sourcemap or --no-sourcemap, not both.");
  }
  const cmd = cmdRaw as Args["cmd"];
  const deckPath = deckPathRaw as string | undefined;

  return {
    cmd,
    deckPath,
    example: parsed.example as string | undefined,
    init: parsed.init as string | undefined,
    initProvided: parsed.init !== undefined,
    message: parsed.message as string | undefined,
    testDeckPath: parsed["test-deck"] as string | undefined,
    graderPath: parsed.grader as string | undefined,
    gradePaths: normalizeFlagList(
      parsed.grade as string | Array<string> | undefined,
    ),
    botInput: parsed["bot-input"] as string | undefined,
    maxTurns: parsePortValue(parsed["max-turns"], "max-turns"),
    model: parsed.model as string | undefined,
    modelForce: parsed["model-force"] as string | undefined,
    trace: parsed.trace as string | undefined,
    stream: Boolean(parsed.stream),
    statePath: parsed.state as string | undefined,
    verbose: Boolean(parsed.verbose),
    port: parsePortValue(parsed.port),
    watch: Boolean(parsed.watch),
    bundle: hasNoBundleFlag ? false : hasBundleFlag ? true : undefined,
    sourcemap: hasNoSourceMapFlag ? false : hasSourceMapFlag ? true : undefined,
    platform: parsed.platform as string | undefined,
    help: Boolean(parsed.help),
  };
}

function printUsage() {
  logger.log(
    `Usage:
  gambit run [<deck.(ts|md)>] [--example <examples/...>] [--init <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--trace <file>] [--state <file>] [--stream] [--verbose]
  gambit repl [<deck.(ts|md)>] [--example <examples/...>] [--init <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--verbose]
  gambit serve [<deck.(ts|md)>] [--example <examples/...>] [--model <id>] [--model-force <id>] [--port <n>] [--verbose] [--watch] [--no-bundle] [--no-sourcemap]
  gambit test-bot <root-deck.(ts|md)> --test-deck <persona-deck.(ts|md)> [--init <json|string>] [--bot-input <json|string>] [--message <json|string>] [--max-turns <n>] [--state <file>] [--grade <grader-deck.(ts|md)> ...] [--trace <file>] [--verbose]
  gambit grade <grader-deck.(ts|md)> --state <file> [--model <id>] [--model-force <id>] [--trace <file>] [--verbose]

Flags:
  --init <json|string>    Init payload (when provided, sent via gambit_init)
  --message <json|string> Initial user message (sent before assistant speaks)
  --test-deck <path>      Persona/test deck path (test-bot only)
  --grade <path>          Grader deck path (repeatable, test-bot only)
  --grader <path>         Grader deck path (grade only; overrides positional)
  --bot-input <json|string> Input payload for the persona deck (test-bot only)
  --max-turns <n>         Max turns for test-bot (default: 12)
  --model <id>            Default model id
  --model-force <id>      Override model id
  --trace <file>          Write trace events to file (JSONL)
  --state <file>          Load and persist state (run/test-bot)
  --stream                Enable streaming responses
  --verbose               Print trace events to console
  --port <n>              Port for serve (default: 8000)
  --watch                 Restart server on file changes (serve)
  --bundle                Force auto-bundling (serve; default)
  --no-bundle             Disable auto-bundling for simulator UI (serve)
  --sourcemap             Generate external source maps (serve; default)
  --no-sourcemap          Disable source map generation (serve)
  --platform <platform>   Bundle target platform: deno (default) or web (browser)
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

function parseBotInput(raw?: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeFlagList(
  value: string | Array<string> | undefined,
): Array<string> {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function slugifyDeckPath(deckPath: string): string {
  const baseName = path.basename(deckPath || "deck");
  const withoutExt = baseName.replace(/\.[^.]+$/, "");
  const slug = withoutExt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return slug || "session";
}

function defaultTestBotStatePath(deckPath: string): string {
  const slug = slugifyDeckPath(deckPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(
    ".gambit",
    "sessions",
    `${slug}-${stamp}`,
    "state.json",
  );
}

function randomId(prefix: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}-${suffix}`;
}

function unwrapSchema(schema: ZodTypeAny): { schema: ZodTypeAny } {
  let current: ZodTypeAny = schema;

  while (current && typeof current === "object") {
    const def =
      (current as { _def?: { typeName?: string; [k: string]: unknown } })
        ._def;
    const typeName = def?.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodNullable") {
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodDefault") {
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodEffects") {
      current = (def as { schema: ZodTypeAny }).schema;
      continue;
    }
    if (typeName === "ZodCatch") {
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodBranded") {
      current = (def as { type: ZodTypeAny }).type;
      continue;
    }
    break;
  }

  return { schema: current };
}

function schemaHasField(
  schema: ZodTypeAny | undefined,
  field: string,
): boolean {
  if (!schema) return false;
  const unwrapped = unwrapSchema(schema).schema;
  const def = (unwrapped as { _def?: { typeName?: string; shape?: unknown } })
    ._def;
  if (def?.typeName !== "ZodObject") return false;
  const shape = typeof def.shape === "function" ? def.shape() : def.shape;
  if (!shape || typeof shape !== "object") return false;
  return field in (shape as Record<string, unknown>);
}

function shouldRetryWithStringInput(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    return error.message.includes("Schema validation failed");
  }
  return false;
}

async function runDeckWithFallback(args: {
  path: string;
  input?: unknown;
  inputProvided?: boolean;
  modelProvider: ModelProvider;
  state?: import("./state.ts").SavedState;
  allowRootStringInput?: boolean;
  initialUserMessage?: string;
  onStateUpdate?: (state: import("./state.ts").SavedState) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  trace?: (event: import("./types.ts").TraceEvent) => void;
}): Promise<unknown> {
  try {
    return await runDeck({
      path: args.path,
      input: args.input,
      inputProvided: args.inputProvided,
      modelProvider: args.modelProvider,
      state: args.state,
      allowRootStringInput: args.allowRootStringInput,
      initialUserMessage: args.initialUserMessage,
      onStateUpdate: args.onStateUpdate,
      stream: args.stream,
      onStreamText: args.onStreamText,
      trace: args.trace,
    });
  } catch (error) {
    if (args.input === undefined && shouldRetryWithStringInput(error)) {
      return await runDeck({
        path: args.path,
        input: "",
        inputProvided: true,
        modelProvider: args.modelProvider,
        state: args.state,
        allowRootStringInput: args.allowRootStringInput,
        initialUserMessage: args.initialUserMessage,
        onStateUpdate: args.onStateUpdate,
        stream: args.stream,
        onStreamText: args.onStreamText,
        trace: args.trace,
      });
    }
    throw error;
  }
}

function findLastAssistantMessage(
  messages: Array<import("./types.ts").ModelMessage>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant") {
      return typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content ?? "");
    }
  }
  return undefined;
}

async function runTestBotLoop(opts: {
  rootDeckPath: string;
  botDeckPath: string;
  init?: unknown;
  initProvided: boolean;
  initialUserMessage?: unknown;
  botInput?: unknown;
  maxTurns: number;
  model?: string;
  modelForce?: string;
  modelProvider: ReturnType<typeof createOpenRouterProvider>;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  verbose?: boolean;
  statePath?: string;
}): Promise<string> {
  let rootState: import("./state.ts").SavedState | undefined = undefined;
  let botState: import("./state.ts").SavedState | undefined = undefined;
  const statePath = opts.statePath ??
    defaultTestBotStatePath(opts.rootDeckPath);
  const capturedTraces: Array<import("./types.ts").TraceEvent> = [];
  const traceWrapper = (event: import("./types.ts").TraceEvent) => {
    capturedTraces.push(event);
    opts.trace?.(event);
  };
  const saveStateToDisk = (state: import("./state.ts").SavedState) => {
    saveState(statePath, { ...state, traces: capturedTraces });
  };

  const existingState = loadState(statePath);
  if (existingState) {
    rootState = existingState;
    if (Array.isArray(existingState.traces)) {
      capturedTraces.push(...existingState.traces);
    }
  }

  const updateRootState = (state: import("./state.ts").SavedState) => {
    rootState = state;
    saveStateToDisk(state);
  };
  let sessionEnded = false;

  const shouldRunRoot = !existingState ||
    opts.initialUserMessage !== undefined;
  if (shouldRunRoot) {
    const initialResult = await runDeck({
      path: opts.rootDeckPath,
      input: opts.init,
      inputProvided: opts.initProvided,
      initialUserMessage: opts.initialUserMessage,
      modelProvider: opts.modelProvider,
      isRoot: true,
      defaultModel: opts.model,
      modelOverride: opts.modelForce,
      trace: traceWrapper,
      stream: false,
      state: rootState,
      onStateUpdate: updateRootState,
    });
    if (isGambitEndSignal(initialResult)) {
      sessionEnded = true;
    }
  }

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    if (sessionEnded) break;
    const history = rootState?.messages ?? [];
    const assistantMessage = findLastAssistantMessage(history);
    if (!assistantMessage) break;
    const botResult = await runDeck({
      path: opts.botDeckPath,
      input: opts.botInput,
      inputProvided: opts.botInput !== undefined,
      initialUserMessage: assistantMessage,
      modelProvider: opts.modelProvider,
      defaultModel: opts.model,
      modelOverride: opts.modelForce,
      trace: traceWrapper,
      stream: false,
      state: botState,
      allowRootStringInput: true,
      onStateUpdate: (state) => {
        botState = state;
      },
    });
    if (isGambitEndSignal(botResult)) {
      sessionEnded = true;
      break;
    }
    const botText = typeof botResult === "string"
      ? botResult
      : JSON.stringify(botResult);
    const userMessage = botText.trim();
    if (!userMessage) break;
    const rootResult = await runDeck({
      path: opts.rootDeckPath,
      input: opts.init,
      inputProvided: opts.initProvided,
      initialUserMessage: userMessage,
      modelProvider: opts.modelProvider,
      isRoot: true,
      defaultModel: opts.model,
      modelOverride: opts.modelForce,
      trace: traceWrapper,
      stream: false,
      state: rootState,
      onStateUpdate: updateRootState,
    });
    if (isGambitEndSignal(rootResult)) {
      sessionEnded = true;
      break;
    }
  }

  logger.log(`Test bot session saved to ${statePath}`);
  return statePath;
}

async function runGraderAgainstState(opts: {
  statePath: string;
  graderPath: string;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  trace?: (event: import("./types.ts").TraceEvent) => void;
}) {
  const state = loadState(opts.statePath);
  if (!state) {
    throw new Error(`State file not found or invalid: ${opts.statePath}`);
  }
  const deck = await loadDeck(opts.graderPath);
  const graderLabel = deck.label ?? path.basename(opts.graderPath);
  const runMode = schemaHasField(deck.inputSchema, "messageToGrade")
    ? "turns"
    : "conversation";
  const metaForGrading = (() => {
    const rawMeta = state.meta;
    if (!rawMeta || typeof rawMeta !== "object") return undefined;
    const next = { ...(rawMeta as Record<string, unknown>) };
    delete next.calibrationRuns;
    delete next.gradingRuns;
    return next;
  })();
  const sessionPayload = {
    messages: Array.isArray(state.messages)
      ? state.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        name: msg.name,
      }))
      : undefined,
    meta: metaForGrading,
    notes: state.notes ? { text: state.notes.text } : undefined,
  };
  const runId = randomId("cal");
  const startedAt = new Date().toISOString();
  type GradingRunRecord = {
    id: string;
    graderId: string;
    graderPath: string;
    graderLabel?: string;
    status: "running" | "completed" | "error";
    runAt?: string;
    referenceSample?: {
      score: number;
      reason: string;
      evidence?: Array<string>;
    };
    input?: unknown;
    result?: unknown;
    error?: string;
  };
  const upsertRun = (
    current: import("./state.ts").SavedState,
    nextEntry: GradingRunRecord,
  ) => {
    const previousRuns = Array.isArray(
        (current.meta as { gradingRuns?: unknown })?.gradingRuns,
      )
      ? ((current.meta as { gradingRuns: Array<GradingRunRecord> })
        .gradingRuns)
      : Array.isArray(current.meta?.calibrationRuns)
      ? (current.meta?.calibrationRuns as Array<GradingRunRecord>)
      : [];
    const index = previousRuns.findIndex((run) => run.id === nextEntry.id);
    const nextRuns = index >= 0
      ? previousRuns.map((run, i) => (i === index ? nextEntry : run))
      : [...previousRuns, nextEntry];
    const nextState = {
      ...current,
      meta: {
        ...(current.meta ?? {}),
        gradingRuns: nextRuns,
      },
    };
    saveState(opts.statePath, nextState);
    return nextState;
  };
  let currentState = state;
  let entry: GradingRunRecord;
  try {
    const result = await (async () => {
      if (runMode !== "turns") {
        return await runDeckWithFallback({
          path: opts.graderPath,
          input: { session: sessionPayload },
          inputProvided: true,
          modelProvider: opts.modelProvider,
          allowRootStringInput: false,
          initialUserMessage: undefined,
          stream: false,
          trace: opts.trace,
        });
      }
      const messages = sessionPayload.messages ?? [];
      const assistantTurns = messages
        .map((msg, idx) => ({ msg, idx }))
        .filter(({ msg }) =>
          msg.role === "assistant" &&
          typeof msg.content === "string" &&
          msg.content.trim().length > 0
        );
      const turns: Array<{
        index: number;
        message: unknown;
        input: unknown;
        result: unknown;
      }> = [];
      entry = {
        id: runId,
        graderId: opts.graderPath,
        graderPath: opts.graderPath,
        graderLabel,
        status: "running",
        runAt: startedAt,
        result: { mode: "turns", turns: [] },
      };
      currentState = upsertRun(currentState, entry);
      if (assistantTurns.length === 0) {
        return { mode: "turns", turns: [] };
      }
      for (const { msg, idx } of assistantTurns) {
        const input = {
          session: {
            ...sessionPayload,
            messages: messages.slice(0, idx + 1),
          },
          messageToGrade: msg,
        };
        const turnResult = await runDeckWithFallback({
          path: opts.graderPath,
          input,
          inputProvided: true,
          modelProvider: opts.modelProvider,
          allowRootStringInput: false,
          initialUserMessage: undefined,
          stream: false,
          trace: opts.trace,
        });
        turns.push({
          index: idx,
          message: msg,
          input,
          result: turnResult,
        });
        entry = {
          ...entry,
          result: { mode: "turns", turns: [...turns] },
        };
        currentState = upsertRun(currentState, entry);
      }
      return { mode: "turns", turns };
    })();
    entry = {
      id: runId,
      graderId: opts.graderPath,
      graderPath: opts.graderPath,
      graderLabel,
      status: "completed",
      runAt: startedAt,
      input: { session: sessionPayload },
      result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    entry = {
      id: runId,
      graderId: opts.graderPath,
      graderPath: opts.graderPath,
      graderLabel,
      status: "error",
      runAt: startedAt,
      input: { session: sessionPayload },
      error: message,
    };
  }
  upsertRun(currentState, entry);
  logger.log(
    `Grading run (${runMode}) saved to ${opts.statePath} [${entry.status}]`,
  );
}

async function main() {
  try {
    const args = parseCliArgs(Deno.args);
    if (args.help || !args.cmd) {
      printUsage();
      Deno.exit(args.cmd ? 0 : 1);
    }
    if (!["run", "repl", "serve", "test-bot", "grade"].includes(args.cmd)) {
      logger.error(
        "Only `run`, `repl`, `serve`, `test-bot`, and `grade` are supported",
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
        (args.cmd === "repl" ? resolveDefaultReplDeckPath() ?? "" : "");

    if (!deckPath && args.cmd !== "grade") {
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
      const bundlePlatform = (() => {
        const raw = (args.platform ?? "deno").toLowerCase();
        if (raw === "deno") return "deno" as const;
        if (raw === "web" || raw === "browser") return "browser" as const;
        throw new Error(
          `Invalid --platform ${args.platform}; expected deno or web`,
        );
      })();
      const autoBundle = args.bundle ?? true;
      const sourceMap = args.sourcemap ?? true;
      if (!autoBundle && sourceMap) {
        throw new Error(
          "--sourcemap requires bundling; remove --no-bundle or add --no-sourcemap.",
        );
      }
      const startServer = () =>
        startWebSocketSimulator({
          deckPath,
          model: args.model,
          modelForce: args.modelForce,
          modelProvider: provider,
          port,
          verbose: args.verbose,
          autoBundle,
          sourceMap,
          bundlePlatform,
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

    if (isGambitEndSignal(result)) {
      if (result.message) {
        logger.log(result.message);
      } else if (result.payload !== undefined) {
        if (typeof result.payload === "string") {
          logger.log(result.payload);
        } else {
          logger.log(JSON.stringify(result.payload, null, 2));
        }
      } else {
        logger.log(JSON.stringify(result, null, 2));
      }
    } else if (typeof result === "string") {
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
