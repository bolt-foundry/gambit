#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
import {
  parseCliArgs,
  printCommandUsage,
} from "@bolt-foundry/gambit/src/cli_args.ts";
import { createDefaultedRuntime } from "@bolt-foundry/gambit/src/default_runtime.ts";
import {
  loadProjectConfig,
  resolveWorkerSandboxSetting,
} from "@bolt-foundry/gambit/src/project_config.ts";
import { parseContext } from "@bolt-foundry/gambit/src/cli_utils.ts";
import { handleServeCommand } from "./commands/serve.ts";

const logger = console;

async function main() {
  const args = parseCliArgs(Deno.args);
  if (args.help || args.cmd === "help") {
    printCommandUsage("serve");
    return;
  }
  if (args.cmd !== "serve") {
    logger.error(
      'gambit-simulator currently supports only the "serve" command.',
    );
    Deno.exit(1);
  }
  if (args.deckPath && args.artifactPath) {
    logger.error(
      "serve accepts either a deck path or --artifact, not both.",
    );
    Deno.exit(1);
  }
  const configHint = args.deckPath || Deno.cwd();
  const projectConfig = await loadProjectConfig(configHint);
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
  await handleServeCommand({
    deckPath: args.deckPath,
    artifactPath: args.artifactPath,
    buildAssistantProvider: args.buildAssistantProvider,
    model: args.model,
    modelForce: args.modelForce,
    modelProvider: runtime.modelProvider,
    context: parseContext(args.context),
    contextProvided: args.contextProvided,
    port: args.port,
    verbose: args.verbose,
    watch: args.watch,
    bundle: args.bundle,
    sourcemap: args.sourcemap,
    platform: args.platform,
    responsesMode: runtime.responsesMode,
    workerSandbox,
  });
}

if (import.meta.main) {
  await main();
}
