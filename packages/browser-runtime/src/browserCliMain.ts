#!/usr/bin/env -S deno run -A

export { runBrowserCli } from "./browserCli.ts";
import { runBrowserCli } from "./browserCli.ts";

if (import.meta.main) {
  Deno.exit(await runBrowserCli(Deno.args));
}
