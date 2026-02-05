import * as path from "@std/path";
import { existsSync } from "@std/fs";
import { startWebSocketSimulator } from "../server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import { parsePortValue, resolveProjectRoot } from "../cli_utils.ts";
import { createWorkspaceScaffold } from "../workspace.ts";

const logger = console;

export async function handleServeCommand(opts: {
  deckPath?: string;
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
}) {
  const cwd = Deno.cwd();
  const baseRoot = opts.deckPath ? resolveProjectRoot(cwd) ?? cwd : cwd;
  const workspaceBaseDir = path.join(baseRoot, ".gambit", "workspaces");
  const sessionsDir = path.join(baseRoot, ".gambit", "sessions");
  let resolvedDeckPath = opts.deckPath?.trim();
  let workspaceConfig:
    | {
      id: string;
      rootDeckPath: string;
      rootDir: string;
      onboarding?: boolean;
      scaffoldEnabled?: boolean;
      scaffoldRoot?: string;
    }
    | undefined;
  if (!resolvedDeckPath) {
    const localPrompt = path.join(cwd, "PROMPT.md");
    if (existsSync(localPrompt)) {
      resolvedDeckPath = localPrompt;
    } else {
      const workspace = await createWorkspaceScaffold({
        baseDir: workspaceBaseDir,
      });
      resolvedDeckPath = workspace.rootDeckPath;
      workspaceConfig = {
        id: workspace.id,
        rootDeckPath: workspace.rootDeckPath,
        rootDir: workspace.rootDir,
        onboarding: true,
        scaffoldEnabled: true,
        scaffoldRoot: workspaceBaseDir,
      };
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
      model: opts.model,
      modelForce: opts.modelForce,
      modelProvider: opts.modelProvider,
      initialContext: opts.context,
      contextProvided: opts.contextProvided,
      port,
      verbose: opts.verbose,
      sessionDir: workspaceConfig ? sessionsDir : undefined,
      workspace: workspaceConfig,
      autoBundle,
      forceBundle,
      sourceMap,
      bundlePlatform,
      responsesMode: opts.responsesMode,
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
