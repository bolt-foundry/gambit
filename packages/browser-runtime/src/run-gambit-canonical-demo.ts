#!/usr/bin/env -S deno run -A

import { copy, ensureDir } from "@std/fs";
import * as path from "@std/path";
import { createWorkspaceScaffoldAtRoot } from "@bolt-foundry/gambit-simulator/src/workspace.ts";
import { runCanonicalDemoTimeline } from "./gambit/canonical-demo-timeline.ts";
import { runE2e } from "./e2e/utils.ts";
import { createDemoTestDeckSession } from "./gambit/demo-test-deck.ts";
import { bfmonoRoot } from "./paths.ts";

const SANDBOX_DIR_NAME = "sandbox";
const DEFAULT_NUX_DEMO_DECK_RELATIVE =
  "src/decks/demo/nux_from_scratch/root.deck.md";
const DEFAULT_GAMBIT_BOT_DECK_RELATIVE = "src/decks/gambit-bot/PROMPT.md";
const CANONICAL_PROMPT_DRIVER_FILENAME = ".canonical_prompt_driver.deck.md";
const PROMPT_DRIVER_MODE_ENV = "GAMBIT_CANONICAL_PROMPT_DRIVER_MODE";

type DemoPromptDriver = {
  nextPrompt: (assistantPrompt?: string) => Promise<string>;
};

const SCRIPTED_CANONICAL_PROMPTS: Array<string> = [
  "I want to build a customer-support assistant for hardware orders. It should greet the user, collect their order number, summarize the issue, and promise to follow up.",
  "Add a scenario test where the user asks about order 1234, provides the issue, and expects the assistant to confirm the order number was captured.",
  "Add a grader that checks the assistant clearly asks for an order number and acknowledges the issue before ending the chat.",
];

function shouldUseDeckPromptDriver(): boolean {
  const mode = (Deno.env.get(PROMPT_DRIVER_MODE_ENV) ?? "scripted").trim()
    .toLowerCase();
  return mode === "deck" || mode === "scenario";
}

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
  await Deno.remove(opts.sandboxRoot, { recursive: true }).catch(() => {});
  await ensureDir(opts.sandboxRoot);

  const scaffold = await createWorkspaceScaffoldAtRoot(opts.sandboxRoot);
  const override = Deno.env.get("GAMBIT_NUX_DEMO_DECK_PATH")?.trim();
  if (!override) {
    return scaffold.rootDeckPath;
  }

  const sourceDeckPath = path.resolve(opts.sourceDeckPath);
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

function createScriptedPromptDriver(): DemoPromptDriver {
  const turns = [...SCRIPTED_CANONICAL_PROMPTS];
  let index = 0;
  return {
    nextPrompt: () => {
      if (index >= turns.length) return Promise.resolve("");
      const turn = turns[index];
      index += 1;
      return Promise.resolve(turn);
    },
  };
}

async function resolveDemoPromptDriver(
  deckPath?: string | null,
  workspaceRoot?: string,
): Promise<DemoPromptDriver> {
  if (deckPath) {
    try {
      let effectiveDeckPath = deckPath;
      if (workspaceRoot) {
        effectiveDeckPath = await materializePromptDriverDeckAtWorkspaceRoot({
          sourceDeckPath: deckPath,
          workspaceRoot,
        });
      }
      const stat = await Deno.stat(effectiveDeckPath);
      if (stat.isFile) {
        const session = createDemoTestDeckSession({
          deckPath: effectiveDeckPath,
          workspaceRoot,
        });
        return { nextPrompt: session.nextPrompt };
      }
    } catch {
      // ignore missing/unavailable prompt deck; fall back to scripted prompts
    }
  }
  return createScriptedPromptDriver();
}

async function materializePromptDriverDeckAtWorkspaceRoot(opts: {
  sourceDeckPath: string;
  workspaceRoot: string;
}): Promise<string> {
  const sourceDeck = path.resolve(opts.sourceDeckPath);
  const destinationDeck = path.join(
    opts.workspaceRoot,
    CANONICAL_PROMPT_DRIVER_FILENAME,
  );
  const contents = await Deno.readTextFile(sourceDeck);
  await Deno.writeTextFile(destinationDeck, contents);
  return destinationDeck;
}

function parseFirstScenarioPathFromDeckContents(
  contents: string,
): string | null {
  const lines = contents.split(/\r?\n/);
  let inFrontmatter = false;
  let inScenarioBlock = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!inFrontmatter) {
      if (line === "+++") {
        inFrontmatter = true;
      }
      continue;
    }
    if (line === "+++") break;
    if (line.startsWith("[[") && line.endsWith("]]")) {
      inScenarioBlock = line.toLowerCase() === "[[scenarios]]";
      continue;
    }
    if (!inScenarioBlock) continue;
    const match = line.match(/^path\s*=\s*["']([^"']+)["']\s*$/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function resolveFirstGambitScenarioDeckPath(opts: {
  gambitPackageRoot: string;
}): Promise<string | null> {
  const gambitBotDeckPath = path.resolve(
    opts.gambitPackageRoot,
    DEFAULT_GAMBIT_BOT_DECK_RELATIVE,
  );
  try {
    const rawDeck = await Deno.readTextFile(gambitBotDeckPath);
    const firstScenarioPath = parseFirstScenarioPathFromDeckContents(rawDeck);
    if (!firstScenarioPath) return null;
    const resolved = path.resolve(
      path.dirname(gambitBotDeckPath),
      firstScenarioPath,
    );
    const stat = await Deno.stat(resolved);
    if (!stat.isFile) return null;
    return resolved;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const repoRoot = bfmonoRoot;
  const gambitPackageRoot = path.resolve(repoRoot, "packages", "gambit");
  const useDeckPromptDriver = shouldUseDeckPromptDriver();
  const gambitScenarioDeckPath = useDeckPromptDriver
    ? await resolveFirstGambitScenarioDeckPath({
      gambitPackageRoot,
    })
    : null;
  const previousBotRoot = Deno.env.get("GAMBIT_SIMULATOR_BUILD_BOT_ROOT");
  const sourceDeckPath = resolveSourceDeckPath({
    repoRoot,
    gambitPackageRoot,
  });
  let promptDriver = createScriptedPromptDriver();
  let sandboxDeckPath = "";
  let sandboxRoot = "";

  try {
    await runE2e(
      "gambit canonical demo timeline",
      async (ctx) => {
        const maxTurns = Number(
          Deno.env.get("GAMBIT_DEMO_MAX_TURNS")?.trim() ?? "6",
        );
        await runCanonicalDemoTimeline(ctx, {
          nextPrompt: promptDriver.nextPrompt,
          maxTurns,
        });
      },
      {
        slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
          "gambit-canonical-demo",
        iframeTargetPath: "/build",
        prepare: async (paths) => {
          sandboxRoot = path.join(paths.latestDir, SANDBOX_DIR_NAME);
          sandboxDeckPath = await prepareSandboxDeck({
            sourceDeckPath,
            sandboxRoot,
          });
          Deno.env.set("GAMBIT_SIMULATOR_BUILD_BOT_ROOT", sandboxRoot);
          Deno.stdout.writeSync(
            new TextEncoder().encode(
              `[canonical-demo] sandbox prepared: root=${sandboxRoot} deck=${sandboxDeckPath} promptDriverSource=${
                useDeckPromptDriver
                  ? gambitScenarioDeckPath ?? "(scripted-fallback)"
                  : "(scripted)"
              }\n`,
            ),
          );
          promptDriver = await resolveDemoPromptDriver(
            useDeckPromptDriver ? gambitScenarioDeckPath : null,
            sandboxRoot,
          );
        },
        server: {
          cwd: gambitPackageRoot,
          command: (targetPort: number) => {
            if (!sandboxDeckPath) {
              throw new Error("Sandbox deck path was not prepared.");
            }
            return [
              "deno",
              "run",
              "-A",
              "src/cli.ts",
              "serve",
              sandboxDeckPath,
              "--bundle",
              "--port",
              String(targetPort),
            ];
          },
        },
      },
    );
  } finally {
    if (previousBotRoot === undefined) {
      Deno.env.delete("GAMBIT_SIMULATOR_BUILD_BOT_ROOT");
    } else {
      Deno.env.set("GAMBIT_SIMULATOR_BUILD_BOT_ROOT", previousBotRoot);
    }
  }
}

if (import.meta.main) {
  await main();
}
