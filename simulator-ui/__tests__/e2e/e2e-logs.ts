#!/usr/bin/env -S deno run -A

import { expandGlob } from "@std/fs";
import * as path from "@std/path";

async function findLogFiles(
  root: string,
  slugPattern: string,
  errorsOnly: boolean,
): Promise<Array<string>> {
  const pattern = path.join(
    root,
    slugPattern,
    "__latest__",
    "logs",
    errorsOnly ? "*errors.log" : "*.log",
  );
  const paths: Array<string> = [];
  for await (const entry of expandGlob(pattern)) {
    if (entry.isFile) paths.push(entry.path);
  }
  return paths.sort();
}

async function e2eLogs(args: Array<string>): Promise<number> {
  const parsed = { slug: "*", errorsOnly: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--errors-only" || arg === "-e") {
      parsed.errorsOnly = true;
      continue;
    }
    if (arg.startsWith("-")) continue;
    parsed.slug = arg;
  }

  const root = path.resolve(
    path.dirname(path.fromFileUrl(import.meta.url)),
    "../../../../..",
    "..",
    "shared",
    "bft-e2e",
  );
  const waitStart = Date.now();
  let printedWaiting = false;

  // Wait until at least one log exists (up to 60s), since tests may be starting up
  let files: Array<string> = await findLogFiles(
    root,
    parsed.slug,
    parsed.errorsOnly,
  );
  while (files.length === 0 && Date.now() - waitStart < 60_000) {
    if (!printedWaiting) {
      console.log(
        `Waiting for logs in ${
          path.join(root, parsed.slug, "__latest__", "logs")
        }`,
      );
      printedWaiting = true;
    }
    await new Promise((r) => setTimeout(r, 1000));
    files = await findLogFiles(root, parsed.slug, parsed.errorsOnly);
  }

  if (files.length === 0) {
    console.log(
      "No log files found. Start an E2E run first, then re-run this command.",
    );
    return 1;
  }

  const cmd = new Deno.Command("tail", {
    args: ["-n", "+1", "-F", ...files],
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  });
  const proc = cmd.spawn();
  const status = await proc.status;
  return status.success ? 0 : (status.code ?? 1);
}

if (import.meta.main) {
  const exit = await e2eLogs(Deno.args);
  Deno.exit(exit);
}
