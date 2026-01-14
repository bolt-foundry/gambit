import * as path from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import { normalizeFlagList, parsePortValue } from "./cli_utils.ts";

const logger = console;

type Args = {
  cmd: "run" | "repl" | "serve" | "test-bot" | "grade" | "export";
  deckPath?: string;
  exportDeckPath?: string;
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
  outPath?: string;
  verbose?: boolean;
  port?: number;
  watch?: boolean;
  bundle?: boolean;
  sourcemap?: boolean;
  platform?: string;
  help?: boolean;
};

function resolveBundledPath(specifier: string): string | null {
  try {
    const resolved = import.meta.resolve(specifier);
    if (resolved.startsWith("file:")) {
      return path.fromFileUrl(resolved);
    }
  } catch {
    // ignore and fall through
  }
  return null;
}

const DEFAULT_REPL_DECK_PATH = resolveBundledPath(
  "./decks/gambit-assistant.deck.md",
);

export function resolveDefaultReplDeckPath(): string | null {
  if (!DEFAULT_REPL_DECK_PATH) {
    logger.error(
      "Default REPL deck is unavailable when running from a remote URL. " +
        "Pass a deck path (e.g. src/decks/gambit-assistant.deck.md) or run from a local checkout.",
    );
    return null;
  }
  return DEFAULT_REPL_DECK_PATH;
}

export function parseCliArgs(argv: Array<string>): Args {
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
      "deck",
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
      "out",
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
    exportDeckPath: parsed.deck as string | undefined,
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
    outPath: parsed.out as string | undefined,
    verbose: Boolean(parsed.verbose),
    port: parsePortValue(parsed.port),
    watch: Boolean(parsed.watch),
    bundle: hasNoBundleFlag ? false : hasBundleFlag ? true : undefined,
    sourcemap: hasNoSourceMapFlag ? false : hasSourceMapFlag ? true : undefined,
    platform: parsed.platform as string | undefined,
    help: Boolean(parsed.help),
  };
}

export function printUsage() {
  logger.log(
    `Usage:
  gambit run [<deck.(ts|md)>] [--init <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--trace <file>] [--state <file>] [--stream] [--verbose]
  gambit repl [<deck.(ts|md)>] [--init <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--verbose]
  gambit serve [<deck.(ts|md)>] [--model <id>] [--model-force <id>] [--port <n>] [--verbose] [--watch] [--no-bundle] [--no-sourcemap]
  gambit test-bot <root-deck.(ts|md)> --test-deck <persona-deck.(ts|md)> [--init <json|string>] [--bot-input <json|string>] [--message <json|string>] [--max-turns <n>] [--state <file>] [--grade <grader-deck.(ts|md)> ...] [--trace <file>] [--verbose]
  gambit grade <grader-deck.(ts|md)> --state <file> [--model <id>] [--model-force <id>] [--trace <file>] [--verbose]
  gambit export [<deck.(ts|md)>] --state <file> --out <bundle.tar.gz>

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
  --state <file>          Load/persist state (run/test-bot) or export from state (export)
  --stream                Enable streaming responses
  --verbose               Print trace events to console
  --out <file>            Bundle output path (export)
  --port <n>              Port for serve (default: 8000)
  --watch                 Restart server on file changes (serve)
  --bundle                Force auto-bundling (serve; default)
  --no-bundle             Disable auto-bundling for simulator UI (serve)
  --sourcemap             Generate external source maps (serve; default)
  --no-sourcemap          Disable source map generation (serve)
  --platform <platform>   Bundle target platform: deno (default) or web (browser)
  -h, --help              Show this help
  repl default deck       src/decks/gambit-assistant.deck.md
`,
  );
}

export type { Args };
