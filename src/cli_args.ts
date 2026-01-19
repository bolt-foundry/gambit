import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { parse as parseToml } from "@std/toml";
import { normalizeFlagList, parsePortValue } from "./cli_utils.ts";

const logger = console;

const COMMANDS = [
  "demo",
  "init",
  "run",
  "repl",
  "serve",
  "test-bot",
  "grade",
  "export",
] as const;

type Command = typeof COMMANDS[number];

function isKnownCommand(cmd?: string): cmd is Command {
  return COMMANDS.includes(cmd as Command);
}

const HELP_COMMANDS = [
  "demo",
  "init",
  "run",
  "repl",
  "serve",
  "test-bot",
  "grade",
] as const;

type HelpCommand = typeof HELP_COMMANDS[number];

function isHelpCommand(cmd?: string): cmd is HelpCommand {
  return HELP_COMMANDS.includes(cmd as HelpCommand);
}

type Args = {
  cmd: Command | "help";
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
  version?: boolean;
};

type CommandDoc = {
  command: Command;
  summary: string;
  usage: string;
  flags: Array<string>;
  details: string;
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

const COMMAND_DOC_ROOT = "../docs/cli/commands";

function resolveCommandDocPath(cmd: Command): string | null {
  return resolveBundledPath(`${COMMAND_DOC_ROOT}/${cmd}.md`);
}

function parseTomlFrontMatter(
  text: string,
): { data: Record<string, unknown>; body: string } | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "+++") return null;
  const endIndex = lines.indexOf("+++", 1);
  if (endIndex === -1) return null;
  const tomlText = lines.slice(1, endIndex).join("\n");
  const body = lines.slice(endIndex + 1).join("\n");
  const data = parseToml(tomlText) as Record<string, unknown>;
  return { data, body };
}

function normalizeCommandDocField(
  value: unknown,
): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed;
}

function normalizeCommandDocFlags(
  value: unknown,
): Array<string> {
  if (!Array.isArray(value)) return [];
  const flags = value.filter((item): item is string =>
    typeof item === "string" && item.trim() !== ""
  );
  return flags;
}

function loadCommandDoc(cmd: HelpCommand): CommandDoc {
  const docPath = resolveCommandDocPath(cmd);
  if (!docPath) {
    throw new Error(`Missing command doc for "${cmd}".`);
  }
  const text = Deno.readTextFileSync(docPath);
  const parsed = parseTomlFrontMatter(text);
  if (!parsed) {
    throw new Error(`Missing TOML front matter in ${docPath}.`);
  }
  const summary = normalizeCommandDocField(parsed.data.summary);
  const usage = normalizeCommandDocField(parsed.data.usage);
  const flags = normalizeCommandDocFlags(parsed.data.flags);
  if (!summary || !usage) {
    throw new Error(`Command doc ${docPath} is missing required fields.`);
  }
  const details = parsed.body.trim();
  return {
    command: cmd,
    summary,
    usage,
    flags,
    details,
  };
}

function loadCommandDocs(): Array<CommandDoc> {
  return HELP_COMMANDS.map(loadCommandDoc);
}

function formatIndentedBlock(text: string, indent: string): string {
  return text.split("\n").map((line) => (line ? `${indent}${line}` : line))
    .join("\n");
}

function formatCommandDoc(doc: CommandDoc, includeDetails: boolean): string {
  const lines: Array<string> = [];
  lines.push("Usage:");
  lines.push(formatIndentedBlock(doc.usage, "  "));
  if (doc.flags.length > 0) {
    lines.push("");
    lines.push("Flags:");
    for (const flag of doc.flags) {
      lines.push(formatIndentedBlock(flag, "  "));
    }
  }
  if (includeDetails && doc.details) {
    lines.push("");
    lines.push(doc.details);
  }
  return lines.join("\n");
}

export function parseCliArgs(argv: Array<string>): Args {
  const parsed = parseArgs(argv, {
    boolean: [
      "stream",
      "verbose",
      "help",
      "version",
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
      version: "V",
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
    version: Boolean(parsed.version),
  };
}

export function printUsage() {
  const docs = loadCommandDocs();
  const lines: Array<string> = [];
  lines.push("Usage:");
  lines.push("  gambit <command> [options]");
  lines.push("  gambit help [command]");
  lines.push("");
  lines.push("Commands:");
  for (const doc of docs) {
    lines.push(`  ${doc.command.padEnd(9)} ${doc.summary}`);
  }
  lines.push("");
  lines.push("Help:");
  lines.push("  gambit help <command>   Show command-specific help");
  lines.push("  gambit help --verbose   Show full usage and all flags");
  lines.push("");
  lines.push("Details:");
  for (const doc of docs) {
    lines.push("");
    lines.push(formatCommandDoc(doc, true));
  }
  logger.log(lines.join("\n"));
}

export function printShortUsage() {
  const docs = loadCommandDocs();
  const lines: Array<string> = [];
  lines.push("Usage:");
  lines.push("  gambit <command> [options]");
  lines.push("  gambit help [command]");
  lines.push("");
  lines.push("Commands:");
  for (const doc of docs) {
    lines.push(`  ${doc.command.padEnd(9)} ${doc.summary}`);
  }
  lines.push("");
  lines.push("Help:");
  lines.push("  gambit help <command>   Show command-specific help");
  lines.push("  gambit help --verbose   Show full usage and all flags");
  logger.log(lines.join("\n"));
}

export function printCommandUsage(cmd: HelpCommand) {
  const doc = loadCommandDoc(cmd);
  logger.log(formatCommandDoc(doc, true));
}

export type { Args, Command };
export { COMMANDS, HELP_COMMANDS, isHelpCommand, isKnownCommand };
