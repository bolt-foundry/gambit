#!/usr/bin/env -S deno run -A

import { runBrowserCli } from "@bolt-foundry/browser-runtime/browser-cli";

if (import.meta.main) {
  Deno.exit(await runBrowserCli(Deno.args));
}
