#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/**
 * Gambit CLI entrypoint for running decks, REPLs, simulators, and tooling.
 *
 * @module
 */
import { parse } from "@std/jsonc";
import * as path from "@std/path";
import { load as loadDotenv } from "@std/dotenv";
import { makeConsoleTracer, makeJsonlTracer } from "./trace.ts";
import { startTui } from "./tui.ts";
import type { PermissionDeclarationInput } from "@bolt-foundry/gambit-core";
import { handleCheckCommand } from "./commands/check.ts";
import { handleRunCommand } from "./commands/run.ts";
import { handleServeCommand } from "./commands/serve.ts";
import { runTestBotLoop } from "./commands/test_bot.ts";
import { runGraderAgainstState } from "./commands/grade.ts";
import { exportBundle } from "./commands/export.ts";
import { handleDemoCommand } from "./commands/demo.ts";
import { parseBotInput, parseContext, parseMessage } from "./cli_utils.ts";
import {
  isHelpCommand,
  isKnownCommand,
  parseCliArgs,
  printCommandUsage,
  printShortUsage,
  printUsage,
} from "./cli_args.ts";
import {
  loadProjectConfig,
  resolveWorkerSandboxSetting,
  resolveWorkspacePermissions,
} from "./project_config.ts";
import { resolveProjectRoot } from "./cli_utils.ts";
import { createDefaultedRuntime } from "./default_runtime.ts";

const logger = console;
const BOT_ROOT_ENV = "GAMBIT_BOT_ROOT";

function printInitRemovedGuidance() {
  logger.error(
    "The `gambit init` command has been removed and is no longer supported.",
  );
  logger.error("Use `gambit serve <deck>` as the onboarding path.");
}

function resolveSessionPermissionsFromArgs(args: {
  allowAll?: boolean;
  allowRead?: true | Array<string>;
  allowWrite?: true | Array<string>;
  allowRun?: true | Array<string>;
  allowNet?: true | Array<string>;
  allowEnv?: true | Array<string>;
}): PermissionDeclarationInput | undefined {
  if (args.allowAll) {
    return {
      read: true,
      write: true,
      run: true,
      net: true,
      env: true,
    };
  }
  const out: PermissionDeclarationInput = {};
  if (args.allowRead !== undefined) out.read = args.allowRead;
  if (args.allowWrite !== undefined) out.write = args.allowWrite;
  if (args.allowRun !== undefined) out.run = args.allowRun;
  if (args.allowNet !== undefined) out.net = args.allowNet;
  if (args.allowEnv !== undefined) out.env = args.allowEnv;
  return Object.keys(out).length > 0 ? out : undefined;
}

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

function resolveBotDeckPath(): string {
  const url = new URL("./decks/gambit-bot/PROMPT.md", import.meta.url);
  if (url.protocol !== "file:") {
    throw new Error("Unable to resolve bot deck path.");
  }
  return path.fromFileUrl(url);
}

async function resolveBotRoot(opts: {
  botRoot?: string;
  projectConfig: Awaited<ReturnType<typeof loadProjectConfig>>;
}): Promise<string> {
  const direct = opts.botRoot?.trim();
  const workspaceDecks = opts.projectConfig?.config?.workspace?.decks;
  const projectRoot = opts.projectConfig?.root;
  const inferred = workspaceDecks && projectRoot
    ? path.resolve(projectRoot, workspaceDecks)
    : undefined;
  const raw = direct || inferred;
  if (!raw) {
    throw new Error(
      "bot requires --bot-root or workspace.decks in gambit.toml",
    );
  }
  const resolved = await Deno.realPath(raw);
  const info = await Deno.stat(resolved);
  if (!info.isDirectory) {
    throw new Error(`bot root is not a directory: ${resolved}`);
  }
  return resolved;
}

async function loadGambitEnv() {
  const cwd = Deno.cwd();
  const projectRoot = resolveProjectRoot(cwd);
  const candidates = new Set<string>();

  if (projectRoot) {
    candidates.add(path.join(projectRoot, ".env"));
  }
  candidates.add(path.join(cwd, ".env"));

  // Legacy fallback for old gambit demo layout; prefer root/local .env above.
  if (projectRoot) {
    candidates.add(path.join(projectRoot, "gambit", ".env"));
  }
  candidates.add(path.join(cwd, "gambit", ".env"));

  for (const envPath of candidates) {
    try {
      const info = await Deno.stat(envPath);
      if (!info.isFile) continue;
      await loadDotenv({ envPath, export: true });
      return;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
  }
}

async function main() {
  try {
    await loadGambitEnv();
    const rawCommand = Deno.args[0];
    if (rawCommand === "init") {
      printInitRemovedGuidance();
      Deno.exit(1);
    }

    const args = parseCliArgs(Deno.args);
    if (args.verbose) {
      try {
        Deno.env.set("GAMBIT_VERBOSE", "1");
      } catch {
        // ignore env set failures
      }
    }
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
        if (helpTarget === "init") {
          printInitRemovedGuidance();
          Deno.exit(1);
        }
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
        if (args.deckPath === "init") {
          printInitRemovedGuidance();
          Deno.exit(1);
        }
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

    if (args.cmd === "demo") {
      await handleDemoCommand();
      return;
    }

    const deckPath = args.deckPath ?? args.exportDeckPath ?? "";

    if (args.cmd === "repl" && !args.deckPath) {
      printCommandUsage("repl");
      return;
    }

    if (
      !deckPath && args.cmd !== "grade" && args.cmd !== "export" &&
      args.cmd !== "bot" && args.cmd !== "serve"
    ) {
      printUsage();
      Deno.exit(1);
    }

    const configHint = deckPath || args.graderPath || args.testDeckPath ||
      args.exportDeckPath || Deno.cwd();
    let projectConfig: Awaited<ReturnType<typeof loadProjectConfig>> = null;
    try {
      projectConfig = await loadProjectConfig(configHint);
    } catch (err) {
      logger.error(
        `Failed to load gambit.toml: ${(err as Error).message}`,
      );
      Deno.exit(1);
    }
    const workspacePermissions = resolveWorkspacePermissions(
      projectConfig?.config,
    );
    const sessionPermissions = resolveSessionPermissionsFromArgs(args);
    const sessionPermissionsBaseDir = Deno.cwd();
    const workerSandboxFromConfig = resolveWorkerSandboxSetting(
      projectConfig?.config,
    );
    const workerSandbox = args.workerSandbox ?? workerSandboxFromConfig ?? true;
    const runtime = await createDefaultedRuntime({
      configHint,
      projectConfig,
      responsesMode: args.responses ? true : undefined,
      logger,
    });
    const modelAliasResolver = runtime.modelAliasResolver;
    const fallbackProvider = runtime.configuredFallbackProvider;
    const provider = runtime.modelProvider;
    const responsesMode = runtime.responsesMode;

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
    const googleApiKey = (Deno.env.get("GOOGLE_API_KEY") ??
      Deno.env.get("GEMINI_API_KEY"))?.trim();
    const ollamaBaseURL = Deno.env.get("OLLAMA_BASE_URL") ?? undefined;

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

    if (args.cmd === "check") {
      if (!deckPath) {
        logger.error("check requires a deck path.");
        Deno.exit(1);
      }
      await handleCheckCommand({
        deckPath,
        modelResolver: modelAliasResolver,
        fallbackProvider,
        checkOnline: args.online,
        openRouterApiKey: openRouterApiKey ?? undefined,
        googleApiKey: googleApiKey ?? undefined,
        ollamaBaseURL,
      });
      return;
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

    if (args.cmd === "bot") {
      const botDeckPath = resolveBotDeckPath();
      let botRoot: string;
      try {
        botRoot = await resolveBotRoot({
          botRoot: args.botRoot ?? args.deckPath,
          projectConfig,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        Deno.exit(1);
      }
      Deno.env.set(BOT_ROOT_ENV, botRoot);
      await startTui({
        deckPath: botDeckPath,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        trace: tracer,
        verbose: args.verbose,
        responsesMode,
        toolResultMessage: (event) => {
          if (event.type !== "tool.result") return null;
          if (event.name !== "bot_write") return null;
          const result = event.result as
            | { payload?: { path?: string; action?: string } }
            | undefined;
          const pathValue = result?.payload?.path;
          if (!pathValue) return null;
          const action = result?.payload?.action;
          const suffix = action ? ` (${action})` : "";
          return `file: ${pathValue}${suffix}`;
        },
        workspacePermissions,
        workspacePermissionsBaseDir: projectConfig?.root,
        sessionPermissions,
        sessionPermissionsBaseDir,
        workerSandbox,
      });
      return;
    }

    if (args.cmd === "repl") {
      await startTui({
        deckPath,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        trace: tracer,
        verbose: args.verbose,
        responsesMode,
        initialContext: args.context !== undefined
          ? parseContext(args.context)
          : undefined,
        contextProvided: args.contextProvided,
        initialMessage: parseMessage(args.message),
        workspacePermissions,
        workspacePermissionsBaseDir: projectConfig?.root,
        sessionPermissions,
        sessionPermissionsBaseDir,
        workerSandbox,
      });
      return;
    }

    if (args.cmd === "serve") {
      if (args.deckPath && args.artifactPath) {
        logger.error(
          "serve accepts either a deck path or --artifact, not both.",
        );
        Deno.exit(1);
      }
      await handleServeCommand({
        deckPath: deckPath || undefined,
        artifactPath: args.artifactPath,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        context: parseContext(args.context),
        contextProvided: args.contextProvided,
        port: args.port,
        verbose: args.verbose,
        watch: args.watch,
        bundle: args.bundle,
        sourcemap: args.sourcemap,
        platform: args.platform,
        responsesMode,
        workerSandbox,
      });
      return;
    }

    if (args.cmd === "scenario") {
      if (!deckPath) {
        logger.error("scenario requires a root deck path.");
        Deno.exit(1);
      }
      if (!args.testDeckPath) {
        logger.error("scenario requires --test-deck <persona deck path>.");
        Deno.exit(1);
      }
      const maxTurns = args.maxTurns ?? 12;
      const statePath = await runTestBotLoop({
        rootDeckPath: deckPath,
        botDeckPath: args.testDeckPath,
        context: parseContext(args.context),
        contextProvided: args.contextProvided,
        initialUserMessage: parseMessage(args.message),
        botInput: parseBotInput(args.botInput),
        maxTurns,
        model: args.model,
        modelForce: args.modelForce,
        modelProvider: provider,
        trace: tracer,
        verbose: args.verbose,
        statePath: args.statePath,
        responsesMode,
        workspacePermissions,
        workspacePermissionsBaseDir: projectConfig?.root,
        sessionPermissions,
        sessionPermissionsBaseDir,
        workerSandbox,
      });
      logger.log(`Scenario session saved to ${statePath}`);
      if (args.gradePaths && args.gradePaths.length > 0) {
        for (const graderPath of args.gradePaths) {
          await runGraderAgainstState({
            statePath,
            graderPath,
            model: args.model,
            modelForce: args.modelForce,
            modelProvider: provider,
            trace: tracer,
            responsesMode,
            workerSandbox,
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
        responsesMode,
        workerSandbox,
      });
      return;
    }

    await handleRunCommand({
      deckPath,
      context: parseContext(args.context),
      contextProvided: args.contextProvided,
      message: parseMessage(args.message),
      modelProvider: provider,
      model: args.model,
      modelForce: args.modelForce,
      trace: tracer,
      stream: args.stream,
      statePath: args.statePath,
      responsesMode,
      workspacePermissions,
      workspacePermissionsBaseDir: projectConfig?.root,
      sessionPermissions,
      sessionPermissionsBaseDir,
      workerSandbox,
    });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
