#!/usr/bin/env -S deno run -A

import { copy, ensureDir } from "@std/fs";
import * as path from "@std/path";
import { createWorkspaceScaffoldAtRoot } from "@bolt-foundry/gambit-simulator/src/workspace.ts";
import { bfmonoRoot } from "./paths.ts";

async function prepareSandboxDeck(opts: {
  repoRoot: string;
  sandboxRoot: string;
}): Promise<string> {
  await Deno.remove(opts.sandboxRoot, { recursive: true }).catch(() => {});
  await ensureDir(opts.sandboxRoot);
  const scaffold = await createWorkspaceScaffoldAtRoot(opts.sandboxRoot);

  const override = Deno.env.get("GAMBIT_NUX_DEMO_DECK_PATH")?.trim();
  if (!override) {
    return scaffold.rootDeckPath;
  }

  const sourceDeckPath = path.isAbsolute(override)
    ? override
    : path.resolve(opts.repoRoot, override);
  const sourceDir = path.dirname(sourceDeckPath);
  const sourceInfo = await Deno.stat(sourceDeckPath);
  if (!sourceInfo.isFile) {
    throw new Error(`Demo deck path is not a file: ${sourceDeckPath}`);
  }

  await copy(sourceDir, opts.sandboxRoot, { overwrite: true });
  const relativeDeckPath = path.relative(sourceDir, sourceDeckPath);
  const sandboxDeckPath = path.join(opts.sandboxRoot, relativeDeckPath);
  await Deno.stat(sandboxDeckPath);
  return sandboxDeckPath;
}

async function main(): Promise<void> {
  const repoRoot = bfmonoRoot;
  const gambitPackageRoot = path.resolve(repoRoot, "packages", "gambit");
  const sandboxRoot = Deno.env.get("GAMBIT_SANDBOX_ROOT")?.trim() ||
    path.resolve(repoRoot, "tmp", "gambit-sandbox");
  const port = Deno.env.get("GAMBIT_SANDBOX_PORT")?.trim() || "8000";

  const sandboxDeckPath = await prepareSandboxDeck({
    repoRoot,
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
      "--verbose",
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
