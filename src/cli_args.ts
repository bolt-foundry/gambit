import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { parse as parseToml } from "@std/toml";
import { normalizeFlagList, parsePortValue } from "./cli_utils.ts";

const logger = console;
let initFlagWarningShown = false;
let workerSandboxAliasWarningShown = false;

const COMMANDS = [
  "bot",
  "check",
  "demo",
  "run",
  "repl",
  "serve",
  "scenario",
  "grade",
  "export",
] as const;

type Command = typeof COMMANDS[number];

function isKnownCommand(cmd?: string): cmd is Command {
  return COMMANDS.includes(cmd as Command);
}

const HELP_COMMANDS = [
  "bot",
  "check",
  "demo",
  "run",
  "repl",
  "serve",
  "scenario",
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
  botRoot?: string;
  maxTurns?: number;
  context?: string;
  message?: string;
  contextProvided: boolean;
  model?: string;
  modelForce?: string;
  trace?: string;
  stream?: boolean;
  responses?: boolean;
  statePath?: string;
  outPath?: string;
  artifactPath?: string;
  verbose?: boolean;
  online?: boolean;
  port?: number;
  watch?: boolean;
  bundle?: boolean;
  sourcemap?: boolean;
  platform?: string;
  allowAll?: boolean;
  allowRead?: true | Array<string>;
  allowWrite?: true | Array<string>;
  allowRun?: true | Array<string>;
  allowNet?: true | Array<string>;
  allowEnv?: true | Array<string>;
  workerSandbox?: boolean;
  legacyExec?: boolean;
  help?: boolean;
  version?: boolean;
};

type PermissionFlagValue = {
  provided: boolean;
  all: boolean;
  values: Array<string>;
};

type ParsedPermissionOverrides = {
  argv: Array<string>;
  allowAll: boolean;
  allowRead: PermissionFlagValue;
  allowWrite: PermissionFlagValue;
  allowRun: PermissionFlagValue;
  allowNet: PermissionFlagValue;
  allowEnv: PermissionFlagValue;
  workerSandbox?: boolean;
  workerSandboxSource?: string;
  sandboxAliasUsed: boolean;
  legacyExec: boolean;
};

const STRING_OPTION_FLAGS = [
  "deck",
  "init",
  "context",
  "message",
  "test-deck",
  "grade",
  "grader",
  "bot-input",
  "bot-root",
  "max-turns",
  "model",
  "model-force",
  "platform",
  "trace",
  "state",
  "out",
  "artifact",
  "port",
] as const;
const OPTION_VALUE_FLAGS = new Set(
  STRING_OPTION_FLAGS.map((flag) => `--${flag}`),
);

function parseCsvList(input: string): Array<string> {
  return input
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createPermissionFlagValue(): PermissionFlagValue {
  return { provided: false, all: false, values: [] };
}

function mergePermissionValue(
  target: PermissionFlagValue,
  value: string | undefined,
) {
  target.provided = true;
  if (value === undefined) {
    target.all = true;
    target.values = [];
    return;
  }
  const parsed = parseCsvList(value);
  if (parsed.length === 0) {
    target.all = true;
    target.values = [];
    return;
  }
  if (!target.all) {
    target.values.push(...parsed);
  }
}

function extractPermissionOverrides(
  argv: Array<string>,
): ParsedPermissionOverrides {
  const out: ParsedPermissionOverrides = {
    argv: [],
    allowAll: false,
    allowRead: createPermissionFlagValue(),
    allowWrite: createPermissionFlagValue(),
    allowRun: createPermissionFlagValue(),
    allowNet: createPermissionFlagValue(),
    allowEnv: createPermissionFlagValue(),
    workerSandbox: undefined,
    workerSandboxSource: undefined,
    sandboxAliasUsed: false,
    legacyExec: false,
  };

  const assignWorkerSandbox = (value: boolean, source: string) => {
    if (
      out.workerSandbox !== undefined &&
      out.workerSandbox !== value
    ) {
      throw new Error(
        `Conflicting worker execution flags: ${out.workerSandboxSource} and ${source}.`,
      );
    }
    out.workerSandbox = value;
    if (!out.workerSandboxSource) {
      out.workerSandboxSource = source;
    }
  };

  const flagMap = new Map<string, PermissionFlagValue>([
    ["--allow-read", out.allowRead],
    ["--allow-write", out.allowWrite],
    ["--allow-run", out.allowRun],
    ["--allow-net", out.allowNet],
    ["--allow-env", out.allowEnv],
  ]);
  const isPermissionOverrideToken = (value: string): boolean =>
    value === "-A" ||
    value === "--allow-all" ||
    value === "--sandbox" ||
    value === "--no-sandbox" ||
    value.startsWith("--allow-");
  let consumeNextAsOptionValue = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (consumeNextAsOptionValue) {
      out.argv.push(token);
      consumeNextAsOptionValue = false;
      continue;
    }

    if (token === "--") {
      out.argv.push(...argv.slice(i));
      break;
    }

    if (token.startsWith("--")) {
      const equalsIndex = token.indexOf("=");
      const flagName = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
      if (OPTION_VALUE_FLAGS.has(flagName)) {
        if (equalsIndex === -1 && i + 1 < argv.length) {
          const nextToken = argv[i + 1];
          if (isPermissionOverrideToken(nextToken)) {
            out.argv.push(`${token}=${nextToken}`);
            i++;
            continue;
          }
          out.argv.push(token);
          consumeNextAsOptionValue = true;
          continue;
        }
        out.argv.push(token);
        continue;
      }
    }

    if (token === "-A" || token === "--allow-all") {
      out.allowAll = true;
      continue;
    }
    if (token === "--worker-sandbox") {
      assignWorkerSandbox(true, "--worker-sandbox");
      continue;
    }
    if (token === "--no-worker-sandbox") {
      assignWorkerSandbox(false, "--no-worker-sandbox");
      continue;
    }
    if (token === "--legacy-exec") {
      out.legacyExec = true;
      assignWorkerSandbox(false, "--legacy-exec");
      continue;
    }
    if (token === "--sandbox") {
      out.sandboxAliasUsed = true;
      assignWorkerSandbox(true, "--sandbox");
      continue;
    }
    if (token === "--no-sandbox") {
      out.sandboxAliasUsed = true;
      assignWorkerSandbox(false, "--no-sandbox");
      continue;
    }

    if (token.startsWith("--allow-")) {
      let matched = false;
      for (const [flag, target] of flagMap.entries()) {
        if (token === flag) {
          mergePermissionValue(target, undefined);
          matched = true;
          break;
        }
        if (token.startsWith(`${flag}=`)) {
          mergePermissionValue(target, token.slice(flag.length + 1));
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }

    out.argv.push(token);
  }

  return out;
}

function finalizePermissionFlag(
  value: PermissionFlagValue,
): true | Array<string> | undefined {
  if (!value.provided) return undefined;
  if (value.all) return true;
  const normalized = Array.from(new Set(value.values));
  return normalized.length > 0 ? normalized : true;
}

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

const COMMAND_DOC_ROOT = "../docs/external/reference/cli/commands";

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
  const permissions = extractPermissionOverrides(argv);
  const parsed = parseArgs(permissions.argv, {
    boolean: [
      "stream",
      "responses",
      "verbose",
      "online",
      "help",
      "version",
      "watch",
      "bundle",
      "no-bundle",
      "sourcemap",
    ],
    string: [...STRING_OPTION_FLAGS],
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
    throw new Error("`--input` has been removed; use `--context` instead.");
  }

  const legacyInit = parsed.init as string | undefined;
  const contextArg = parsed.context as string | undefined;
  if (legacyInit !== undefined && contextArg !== undefined) {
    throw new Error("Use either --context or --init, not both.");
  }
  if (legacyInit !== undefined && !initFlagWarningShown) {
    initFlagWarningShown = true;
    logger.warn('[gambit] "--init" is deprecated; use "--context" instead.');
  }
  if (permissions.sandboxAliasUsed && !workerSandboxAliasWarningShown) {
    workerSandboxAliasWarningShown = true;
    logger.warn(
      '[gambit] "--sandbox/--no-sandbox" are deprecated; use "--worker-sandbox/--no-worker-sandbox" (or "--legacy-exec") instead.',
    );
  }
  const contextValue = contextArg ?? legacyInit;
  const contextProvided = contextArg !== undefined || legacyInit !== undefined;

  const [cmdRaw, deckPathRaw] = parsed._;
  const hasBundleFlag = permissions.argv.includes("--bundle");
  const hasNoBundleFlag = permissions.argv.includes("--no-bundle");
  if (hasBundleFlag && hasNoBundleFlag) {
    throw new Error("Use either --bundle or --no-bundle, not both.");
  }
  const hasSourceMapFlag = permissions.argv.includes("--sourcemap");
  const hasNoSourceMapFlag = permissions.argv.includes("--no-sourcemap");
  if (hasSourceMapFlag && hasNoSourceMapFlag) {
    throw new Error("Use either --sourcemap or --no-sourcemap, not both.");
  }
  const cmd = cmdRaw as Args["cmd"];
  const deckPath = deckPathRaw as string | undefined;

  const allowRead = permissions.allowAll ? true : finalizePermissionFlag(
    permissions.allowRead,
  );
  const allowWrite = permissions.allowAll ? true : finalizePermissionFlag(
    permissions.allowWrite,
  );
  const allowRun = permissions.allowAll ? true : finalizePermissionFlag(
    permissions.allowRun,
  );
  const allowNet = permissions.allowAll ? true : finalizePermissionFlag(
    permissions.allowNet,
  );
  const allowEnv = permissions.allowAll ? true : finalizePermissionFlag(
    permissions.allowEnv,
  );

  return {
    cmd,
    deckPath,
    exportDeckPath: parsed.deck as string | undefined,
    context: contextValue,
    contextProvided,
    message: parsed.message as string | undefined,
    testDeckPath: parsed["test-deck"] as string | undefined,
    graderPath: parsed.grader as string | undefined,
    gradePaths: normalizeFlagList(
      parsed.grade as string | Array<string> | undefined,
    ),
    botInput: parsed["bot-input"] as string | undefined,
    botRoot: parsed["bot-root"] as string | undefined,
    maxTurns: parsePortValue(parsed["max-turns"], "max-turns"),
    model: parsed.model as string | undefined,
    modelForce: parsed["model-force"] as string | undefined,
    trace: parsed.trace as string | undefined,
    stream: Boolean(parsed.stream),
    responses: Boolean(parsed.responses),
    statePath: parsed.state as string | undefined,
    outPath: parsed.out as string | undefined,
    artifactPath: parsed.artifact as string | undefined,
    verbose: Boolean(parsed.verbose),
    online: Boolean(parsed.online),
    port: parsePortValue(parsed.port),
    watch: Boolean(parsed.watch),
    bundle: hasNoBundleFlag ? false : hasBundleFlag ? true : undefined,
    sourcemap: hasNoSourceMapFlag ? false : hasSourceMapFlag ? true : undefined,
    platform: parsed.platform as string | undefined,
    allowAll: permissions.allowAll ? true : undefined,
    allowRead,
    allowWrite,
    allowRun,
    allowNet,
    allowEnv,
    workerSandbox: permissions.workerSandbox,
    legacyExec: permissions.legacyExec ? true : undefined,
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
