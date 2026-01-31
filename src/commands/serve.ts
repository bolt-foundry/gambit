import * as path from "@std/path";
import { startWebSocketSimulator } from "../server.ts";
import type { ModelProvider } from "@molt-foundry/gambit-core";
import { parsePortValue } from "../cli_utils.ts";

const logger = console;

export async function handleServeCommand(opts: {
  deckPath: string;
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
      deckPath: opts.deckPath,
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
    });

  if (!opts.watch) {
    const server = startServer();
    await server.finished;
    return;
  }

  const watchTargets = Array.from(
    new Set([
      path.dirname(opts.deckPath),
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
