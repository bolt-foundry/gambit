#!/usr/bin/env -S deno run -A

import * as path from "@std/path";
import {
  seedVerifyFixture,
  type SeedVerifyFixtureOptions,
} from "../src/verify_fixture.ts";

function parseArgs(args: string[]): SeedVerifyFixtureOptions {
  const out: SeedVerifyFixtureOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === "--deck" && args[i + 1]) {
      i += 1;
      out.deckPath = args[i];
      continue;
    }
    if (value === "--sessions-root" && args[i + 1]) {
      i += 1;
      out.sessionsRoot = args[i];
      continue;
    }
    if (value === "--workspace-id" && args[i + 1]) {
      i += 1;
      out.workspaceId = args[i];
      continue;
    }
    if (value === "--help" || value === "-h") {
      console.log(
        [
          "Usage: deno run -A scripts/seed_verify_fixture.ts [options]",
          "",
          "Options:",
          "  --deck <path>           Deck path used to resolve grader metadata.",
          "  --sessions-root <path>  Explicit sessions root (defaults to deck-derived .gambit/workspaces).",
          "  --workspace-id <id>     Workspace id to seed (default: verify-fixture).",
        ].join("\n"),
      );
      Deno.exit(0);
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(Deno.args);
  const seeded = await seedVerifyFixture(opts);
  const relativeSqlite = path.relative(Deno.cwd(), seeded.sqlitePath);
  console.log(
    [
      "[verify-fixture] seeded workspace fixture",
      `workspaceId: ${seeded.workspaceId}`,
      `deckPath: ${seeded.deckPath}`,
      `graderId: ${seeded.graderId}`,
      `runCount: ${seeded.runCount}`,
      `sqlitePath: ${relativeSqlite || seeded.sqlitePath}`,
    ].join("\n"),
  );
}

if (import.meta.main) {
  await main();
}
