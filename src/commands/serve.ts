import * as path from "@std/path";
import { copy, ensureDir, existsSync } from "@std/fs";
import { startWebSocketSimulator } from "../server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import { parsePortValue } from "../cli_utils.ts";
import { restoreServeArtifactBundle } from "./serve_artifact.ts";

const logger = console;
const GAMBIT_BOT_SOURCE_DECK_URL = new URL(
  "../decks/gambit-bot/PROMPT.md",
  import.meta.url,
);
const GAMBIT_BOT_SOURCE_DIR = GAMBIT_BOT_SOURCE_DECK_URL.protocol === "file:"
  ? path.dirname(path.fromFileUrl(GAMBIT_BOT_SOURCE_DECK_URL))
  : "";
const SIMPLE_PROMPT_TEMPLATE = `+++
label = "Local Prompt"
description = "Minimal starter deck created by gambit serve."

[modelParams]
model = ["codex-cli/default"]
+++

You are a helpful assistant.

Keep responses concise and directly answer the user.`;

async function ensureGambitBotPolicyMirror(baseRoot: string) {
  if (!GAMBIT_BOT_SOURCE_DIR) return;
  const policySource = path.join(GAMBIT_BOT_SOURCE_DIR, "policy");
  const policyDest = path.join(baseRoot, ".gambit", "policy");
  try {
    const info = await Deno.stat(policySource);
    if (!info.isDirectory) return;
  } catch {
    return;
  }
  if (existsSync(policyDest)) return;
  await ensureDir(path.dirname(policyDest));
  await copy(policySource, policyDest, { overwrite: false });
}

export function resolveServeWorkspaceRoot(cwd: string): string {
  return path.resolve(cwd);
}

export async function handleServeCommand(opts: {
  deckPath?: string;
  artifactPath?: string;
  model?: string;
  modelForce?: string;
  modelProvider: ModelProvider;
  context?: unknown;
  contextProvided?: boolean;
  port?: number;
  verbose?: boolean;
  watch?: boolean;
  bundle?: boolean;
  sourcemap?: boolean;
  platform?: string;
  responsesMode?: boolean;
  workerSandbox?: boolean;
}) {
  if (opts.deckPath?.trim() && opts.artifactPath?.trim()) {
    throw new Error(
      "serve accepts either a deck path or --artifact, not both.",
    );
  }
  const cwd = Deno.cwd();
  const baseRoot = resolveServeWorkspaceRoot(cwd);
  await ensureGambitBotPolicyMirror(baseRoot);
  let resolvedDeckPath = opts.deckPath?.trim();

  if (opts.artifactPath?.trim()) {
    const restored = await restoreServeArtifactBundle({
      artifactPath: opts.artifactPath,
      projectRoot: baseRoot,
    });
    resolvedDeckPath = restored.rootDeckPath;
    logger.log(
      `[serve] restored artifact workspace ${restored.sessionId} (${
        restored.restored ? "new restore" : "already restored"
      })`,
    );
  }

  if (!resolvedDeckPath) {
    const localPrompt = path.join(cwd, "PROMPT.md");
    if (existsSync(localPrompt)) {
      resolvedDeckPath = localPrompt;
    } else {
      await Deno.writeTextFile(localPrompt, SIMPLE_PROMPT_TEMPLATE);
      logger.log(`[serve] created ${localPrompt}`);
      resolvedDeckPath = localPrompt;
    }
  }
  const envMode = (Deno.env.get("GAMBIT_ENV") ?? Deno.env.get("NODE_ENV") ?? "")
    .toLowerCase();
  const isDevEnv = envMode === "development" || envMode === "dev" ||
    envMode === "local";
  const envPort = parsePortValue(Deno.env.get("PORT"), "PORT");
  const port = opts.port ?? envPort ?? 8000;
  const bundlePlatform = (() => {
    const raw = (opts.platform ?? "deno").toLowerCase();
    if (raw === "deno") return "deno" as const;
    if (raw === "web" || raw === "browser") return "browser" as const;
    throw new Error(
      `Invalid --platform ${opts.platform}; expected deno or web`,
    );
  })();
  const autoBundle = opts.bundle ?? isDevEnv;
  const forceBundle = opts.bundle === true;
  const sourceMap = opts.sourcemap ?? autoBundle;
  if (!autoBundle && sourceMap) {
    throw new Error(
      "--sourcemap requires bundling; remove --no-bundle or add --no-sourcemap.",
    );
  }
  const startServer = () =>
    startWebSocketSimulator({
      deckPath: resolvedDeckPath ?? opts.deckPath ?? "",
      sessionDir: path.join(baseRoot, ".gambit", "workspaces"),
      model: opts.model,
      modelForce: opts.modelForce,
      modelProvider: opts.modelProvider,
      initialContext: opts.context,
      contextProvided: opts.contextProvided,
      port,
      verbose: opts.verbose,
      autoBundle,
      forceBundle,
      sourceMap,
      bundlePlatform,
      responsesMode: opts.responsesMode,
      workerSandbox: opts.workerSandbox,
    });

  if (!opts.watch) {
    const server = startServer();
    await server.finished;
    return;
  }

  const watchTargets = Array.from(
    new Set([
      resolvedDeckPath ? path.dirname(resolvedDeckPath) : path.resolve("."),
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
    `[serve] watching for changes in ${watchTargets.join(", ")}; port=${port}`,
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
}
