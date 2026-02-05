#!/usr/bin/env -S deno run -A

import { copy, ensureDir } from "@std/fs";
import * as path from "@std/path";

const DEFAULT_NUX_DEMO_DECK_RELATIVE =
  "src/decks/demo/nux_from_scratch/root.deck.md";

function resolveSourceDeckPath(opts: {
  repoRoot: string;
  gambitPackageRoot: string;
}): string {
  const override = Deno.env.get("GAMBIT_NUX_DEMO_DECK_PATH")?.trim();
  const fallback = path.resolve(
    opts.gambitPackageRoot,
    DEFAULT_NUX_DEMO_DECK_RELATIVE,
  );
  if (!override) {
    return fallback;
  }
  return path.isAbsolute(override)
    ? override
    : path.resolve(opts.repoRoot, override);
}

async function prepareSandboxDeck(opts: {
  sourceDeckPath: string;
  sandboxRoot: string;
}): Promise<string> {
  const sourceDeckPath = path.resolve(opts.sourceDeckPath);
  const sourceDir = path.dirname(sourceDeckPath);
  const sourceInfo = await Deno.stat(sourceDeckPath);
  if (!sourceInfo.isFile) {
    throw new Error(`Demo deck path is not a file: ${sourceDeckPath}`);
  }

  await Deno.remove(opts.sandboxRoot, { recursive: true }).catch(() => {});
  await ensureDir(opts.sandboxRoot);
  await copy(sourceDir, opts.sandboxRoot, { overwrite: true });

  const relativeDeckPath = path.relative(sourceDir, sourceDeckPath);
  const sandboxDeckPath = path.join(opts.sandboxRoot, relativeDeckPath);
  await Deno.stat(sandboxDeckPath);
  return sandboxDeckPath;
}

async function main(): Promise<void> {
  const moduleDir = path.dirname(path.fromFileUrl(import.meta.url));
  const repoRoot = path.resolve(moduleDir, "..", "..", "..");
  const gambitPackageRoot = path.resolve(repoRoot, "packages", "gambit");
  const sandboxRoot = Deno.env.get("GAMBIT_SANDBOX_ROOT")?.trim() ||
    "/tmp/gambit-bot-sandbox";
  const port = Deno.env.get("GAMBIT_SANDBOX_PORT")?.trim() || "8000";

  const sourceDeckPath = resolveSourceDeckPath({
    repoRoot,
    gambitPackageRoot,
  });
  const sandboxDeckPath = await prepareSandboxDeck({
    sourceDeckPath,
    sandboxRoot,
  });
  Deno.env.set("GAMBIT_SIMULATOR_BUILD_BOT_ROOT", sandboxRoot);

  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "-A",
      "src/cli.ts",
      "serve",
      sandboxDeckPath,
      "--bundle",
      "--port",
      port,
    ],
    cwd: gambitPackageRoot,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const child = cmd.spawn();
  const status = await child.status;
  if (!status.success) {
    Deno.exit(status.code ?? 1);
  }
}

if (import.meta.main) {
  await main();
}
