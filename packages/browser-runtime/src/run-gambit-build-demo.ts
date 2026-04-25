#!/usr/bin/env -S deno run -A

import { copy, ensureDir } from "@std/fs";
import * as path from "@std/path";
import { runTimelineSteps } from "./automation/timeline.ts";
import { runE2e } from "./e2e/utils.ts";
import { createDemoTestDeckSession } from "./gambit/demo-test-deck.ts";
import { bfmonoRoot } from "./paths.ts";
import type { DemoScenarioContext } from "./runner.ts";

const SANDBOX_DIR_NAME = "sandbox";
const DEFAULT_NUX_DEMO_DECK_RELATIVE =
  "src/decks/demo/nux_from_scratch/root.deck.md";
type BuiltinTimelineStep = Parameters<typeof runTimelineSteps>[1][number];
type CustomTimelineStep = {
  type: "custom";
  run: (ctx: DemoScenarioContext) => Promise<void> | void;
};

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

async function readLatestAssistantMessage(
  demoTarget: DemoScenarioContext["demoTarget"],
): Promise<string> {
  const bubbles = demoTarget.locator(".imessage-row.left .imessage-bubble");
  const count = await bubbles.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    const text = (await bubbles.nth(i).innerText()).trim();
    if (text) return text;
  }
  return "";
}

async function waitForBuildWrites(
  demoTarget: DemoScenarioContext["demoTarget"],
  wait: DemoScenarioContext["wait"],
  requiredPaths: Array<string>,
  opts?: { match?: RegExp; matches?: Array<RegExp> },
  timeoutMs = 120_000,
): Promise<{
  paths: Array<string>;
  matchedPath?: string;
  matchedPaths?: Array<string>;
}> {
  const panel = demoTarget.locator('[data-testid="build-changes-panel"]');
  if ((await panel.count()) === 0) {
    const trigger = demoTarget.locator(".build-recent-changes-trigger");
    await trigger.waitFor();
    await trigger.click();
    await panel.waitFor();
  }
  const start = Date.now();
  const locator = demoTarget.locator(
    '[data-testid="build-changes-panel"] code',
  );
  while (Date.now() - start < timeoutMs) {
    const count = await locator.count();
    const found = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      const text = (await locator.nth(i).innerText()).trim();
      if (text) found.add(text);
    }
    const paths = Array.from(found);
    const matchers = opts?.matches ?? (opts?.match ? [opts.match] : []);
    const matchedCandidates = matchers.map((matcher) =>
      paths.find((path) => matcher.test(path))
    );
    const matchedPaths = matchers.length === 0 ||
        matchedCandidates.every(Boolean)
      ? matchedCandidates as Array<string>
      : undefined;
    const matchedPath = matchedPaths?.[0];
    if (
      requiredPaths.every((path) => found.has(path)) &&
      (matchers.length === 0 || matchedCandidates.every(Boolean))
    ) {
      return { paths, matchedPath, matchedPaths };
    }
    await wait(500);
  }
  throw new Error(
    `Build demo expected writes to ${requiredPaths.join(", ")}.`,
  );
}

async function clickTestBotRun(
  demoTarget: DemoScenarioContext["demoTarget"],
): Promise<void> {
  const overlayRun = demoTarget.locator('[data-testid="testbot-run-overlay"]');
  if (await overlayRun.count()) {
    const visible = await overlayRun.first().isVisible().catch(() => false);
    if (visible) {
      await overlayRun.first().click();
      return;
    }
  }
  await demoTarget.locator('[data-testid="testbot-run"]').click();
}

async function clickListboxOption(
  demoTarget: DemoScenarioContext["demoTarget"],
  label: string,
  opts?: { fallbackLabel?: string },
): Promise<string> {
  const popover = demoTarget.locator(".gds-listbox-popover");
  const option = popover.locator(".gds-listbox-option").filter({
    hasText: label,
  });
  if (await option.count()) {
    await option.first().click();
    return label;
  }
  if (opts?.fallbackLabel) {
    const fallback = popover.locator(".gds-listbox-option").filter({
      hasText: opts.fallbackLabel,
    });
    if (await fallback.count()) {
      await fallback.first().click();
      return opts.fallbackLabel;
    }
  }
  throw new Error(
    `Build demo could not find listbox option: ${label}${
      opts?.fallbackLabel ? ` (fallback: ${opts.fallbackLabel})` : ""
    }`,
  );
}

async function openBuildFileListbox(
  demoTarget: DemoScenarioContext["demoTarget"],
  wait: DemoScenarioContext["wait"],
): Promise<void> {
  const trigger = demoTarget
    .locator(".build-files-preview-selector .gds-listbox-trigger")
    .first();
  if ((await trigger.count()) === 0) {
    throw new Error("No build file listbox trigger found.");
  }
  await trigger.click();
  const popover = demoTarget.locator(".gds-listbox-popover");
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (await popover.count()) return;
    await wait(100);
  }
  throw new Error("Build file listbox popover did not appear.");
}

async function openTestDeckListbox(
  demoTarget: DemoScenarioContext["demoTarget"],
  wait: DemoScenarioContext["wait"],
): Promise<void> {
  const trigger = demoTarget
    .locator(".test-bot-sidebar .gds-listbox-trigger")
    .first();
  if ((await trigger.count()) === 0) {
    const placeholder = await demoTarget
      .locator(".test-bot-sidebar .placeholder")
      .first()
      .textContent()
      .catch(() => "");
    throw new Error(
      `No test deck listbox found. ${
        placeholder ? `Placeholder: ${placeholder.trim()}` : "No placeholder."
      }`,
    );
  }
  await trigger.click();
  const popover = demoTarget.locator(".gds-listbox-popover");
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (await popover.count()) return;
    await wait(100);
  }
  throw new Error("Test deck listbox popover did not appear.");
}

async function waitForBuildHeader(
  demoTarget: DemoScenarioContext["demoTarget"],
  wait: DemoScenarioContext["wait"],
  matcher: RegExp,
  timeoutMs = 8000,
): Promise<void> {
  const header = demoTarget.locator(".build-files-preview-header");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = (await header.textContent().catch(() => ""))?.trim() ?? "";
    if (matcher.test(text)) return;
    await wait(200);
  }
  const finalText = (await header.textContent().catch(() => ""))?.trim() ?? "";
  throw new Error(
    `Build file header did not match ${matcher}. Saw "${finalText}".`,
  );
}

function getActiveWorkspaceId(
  demoTarget: DemoScenarioContext["demoTarget"],
): string | null {
  const url = new URL(demoTarget.url());
  const match = url.pathname.match(/\/workspaces\/([^/]+)\//);
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

async function loadScenarioDecks(
  ctx: DemoScenarioContext,
  workspaceId: string | null,
): Promise<Array<{ id: string; label: string }>> {
  const url = new URL("/api/test", ctx.baseUrl);
  if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({})) as {
    testDecks?: Array<{ id?: string; label?: string }>;
  };
  return (data.testDecks ?? []).filter((deck) =>
    typeof deck?.id === "string" && typeof deck?.label === "string"
  ) as Array<{ id: string; label: string }>;
}

async function main(): Promise<void> {
  const repoRoot = bfmonoRoot;
  const gambitPackageRoot = path.resolve(repoRoot, "packages", "gambit");
  const demoTestDeckPath = path.resolve(
    gambitPackageRoot,
    "src",
    "decks",
    "tests",
    "nux_from_scratch_demo.test.deck.md",
  );
  const previousBotRoot = Deno.env.get("GAMBIT_SIMULATOR_BUILD_BOT_ROOT");
  const sourceDeckPath = resolveSourceDeckPath({
    repoRoot,
    gambitPackageRoot,
  });
  let sandboxDeckPath = "";
  let sandboxRoot = "";

  try {
    await runE2e(
      "gambit build tab demo timeline",
      async (ctx) => {
        const persona = createDemoTestDeckSession({
          deckPath: demoTestDeckPath,
          workspaceRoot: sandboxRoot || undefined,
        });
        const maxTurns = Number(
          Deno.env.get("GAMBIT_DEMO_MAX_TURNS")?.trim() ?? "8",
        );
        const runSteps = async (
          steps: Array<BuiltinTimelineStep | CustomTimelineStep>,
        ) => {
          for (const step of steps) {
            if (step.type === "custom") {
              await step.run(ctx);
              continue;
            }
            await runTimelineSteps(ctx, [step]);
          }
        };

        await runSteps([
          { type: "wait-for", selector: '[data-testid="nav-build"]' },
          { type: "click", selector: '[data-testid="nav-build"]' },
          { type: "wait-for", selector: '[data-testid="build-chat-input"]' },
          { type: "wait", ms: 400 },
          { type: "screenshot", label: "02-build-layout-50-50" },
        ]);

        let assistantPrompt: string | undefined = undefined;
        for (let turn = 0; turn < maxTurns; turn += 1) {
          const userPrompt = await persona.nextPrompt(assistantPrompt);
          if (!userPrompt) break;

          await runSteps([
            { type: "click", selector: '[data-testid="build-chat-input"]' },
            {
              type: "type",
              selector: '[data-testid="build-chat-input"]',
              text: userPrompt,
              clear: true,
              delayMs: 25,
            },
            { type: "wait", ms: 250 },
            {
              type: "click",
              selector: turn === 0
                ? '[data-testid="build-start"]'
                : '[data-testid="build-send"]',
            },
            {
              type: "wait-for",
              selector: '[data-testid="build-chat-input"]:not([disabled])',
              timeoutMs: 120_000,
            },
          ]);

          assistantPrompt = await readLatestAssistantMessage(ctx.demoTarget);
          if (!assistantPrompt) {
            throw new Error(
              "Build demo expected an assistant response before the next turn.",
            );
          }
        }

        await runSteps([
          { type: "wait-for", selector: ".build-files-preview-header" },
          {
            type: "wait-for",
            selector:
              ".build-files-preview-selector .gds-listbox-trigger:not([disabled])",
          },
          {
            type: "custom",
            run: async ({ demoTarget, wait }) => {
              await openBuildFileListbox(demoTarget, wait);
            },
          },
          { type: "wait", ms: 200 },
          {
            type: "custom",
            run: async ({ demoTarget }) => {
              await clickListboxOption(demoTarget, "PROMPT.md", {
                fallbackLabel: "root.deck.md",
              });
            },
          },
          {
            type: "wait-for",
            selector: ".build-files-preview-header",
            text: /PROMPT\.md|root\.deck\.md/,
          },
          { type: "wait-for", selector: ".build-file-preview" },
          { type: "wait", ms: 200 },
          {
            type: "wait-for",
            selector:
              ".build-files-preview-selector .gds-listbox-trigger:not([disabled])",
          },
          {
            type: "custom",
            run: async ({ demoTarget, wait }) => {
              await openBuildFileListbox(demoTarget, wait);
            },
          },
          {
            type: "custom",
            run: async ({ demoTarget }) => {
              await clickListboxOption(demoTarget, "INTENT.md");
            },
          },
          {
            type: "custom",
            run: async ({ demoTarget, wait }) => {
              await waitForBuildHeader(demoTarget, wait, /INTENT\.md/);
            },
          },
          { type: "wait-for", selector: ".build-file-preview" },
          { type: "wait", ms: 200 },
          { type: "screenshot", label: "03-build-file-intent" },
          {
            type: "wait-for",
            selector:
              ".build-files-preview-selector .gds-listbox-trigger:not([disabled])",
          },
          {
            type: "custom",
            run: async ({ demoTarget, wait }) => {
              await openBuildFileListbox(demoTarget, wait);
            },
          },
          {
            type: "custom",
            run: async ({ demoTarget }) => {
              await clickListboxOption(demoTarget, "POLICY.md");
            },
          },
          {
            type: "custom",
            run: async ({ demoTarget, wait }) => {
              await waitForBuildHeader(demoTarget, wait, /POLICY\.md/);
            },
          },
          { type: "wait-for", selector: ".build-file-preview" },
          { type: "wait", ms: 200 },
          { type: "screenshot", label: "03-build-file-policy" },
          {
            type: "wait-for",
            selector: '[data-testid="build-changes-count"]',
            text: /[1-9]/,
            timeoutMs: 120_000,
          },
          { type: "wait", ms: 500 },
          { type: "screenshot", label: "02-build-start" },
        ]);

        const writes = await waitForBuildWrites(
          ctx.demoTarget,
          ctx.wait,
          ["PROMPT.md", "INTENT.md", "POLICY.md"],
          {
            matches: [
              /(^|\/)scenarios\/.+\/PROMPT\.md$/,
              /(^|\/)graders\/.+\/PROMPT\.md$/,
            ],
          },
        );
        const scenarioPath = writes.matchedPaths?.[0];
        const graderPath = writes.matchedPaths?.[1];
        if (!scenarioPath) {
          throw new Error("Build demo did not produce a scenario deck file.");
        }
        if (!graderPath) {
          throw new Error("Build demo did not produce a grader deck file.");
        }
        const actionPromptPaths = writes.paths.filter((entry) =>
          /(^|\/)actions\/.+\/PROMPT\.md$/.test(entry)
        );
        if (actionPromptPaths.length < 2) {
          throw new Error(
            "Build demo did not produce at least two action deck PROMPT.md files.",
          );
        }

        await runSteps([
          {
            type: "wait-for",
            selector:
              ".build-files-preview-selector .gds-listbox-trigger:not([disabled])",
          },
          {
            type: "custom",
            run: async ({ demoTarget, wait }) => {
              await openBuildFileListbox(demoTarget, wait);
            },
          },
          {
            type: "custom",
            run: async ({ demoTarget }) => {
              await clickListboxOption(demoTarget, "PROMPT.md", {
                fallbackLabel: "root.deck.md",
              });
            },
          },
          {
            type: "wait-for",
            selector: ".build-files-preview-header",
            text: /PROMPT\.md|root\.deck\.md/,
          },
          { type: "wait-for", selector: ".build-file-preview" },
          {
            type: "wait-for",
            selector: ".build-file-preview",
            text: "[[actions]]",
          },
          {
            type: "wait-for",
            selector: ".build-file-preview",
            text: "[[scenarios]]",
          },
          {
            type: "wait-for",
            selector: ".build-file-preview",
            text: scenarioPath,
          },
          {
            type: "wait-for",
            selector: ".build-file-preview",
            text: "[[graders]]",
          },
          {
            type: "wait-for",
            selector: ".build-file-preview",
            text: graderPath,
          },
          { type: "wait", ms: 200 },
          { type: "screenshot", label: "03-build-root-with-scenarios" },
        ]);

        await runSteps([
          { type: "click", selector: ".build-recent-changes-trigger" },
          { type: "wait-for", selector: '[data-testid="build-changes-panel"]' },
          { type: "scroll", selector: '[data-testid="build-changes-panel"]' },
          { type: "wait", ms: 500 },
          { type: "screenshot", label: "04-build-recent-changes" },
          { type: "click", selector: '[data-testid="nav-test"]' },
          { type: "wait-for", selector: '[data-testid="testbot-run"]' },
          { type: "wait", ms: 400 },
        ]);

        const workspaceId = getActiveWorkspaceId(ctx.demoTarget);
        const scenarios = await loadScenarioDecks(ctx, workspaceId);
        if (scenarios.length === 0) {
          throw new Error("Build demo found no scenarios to run.");
        }

        await runSteps([
          {
            type: "custom",
            run: async ({ demoTarget, wait }) => {
              await openTestDeckListbox(demoTarget, wait);
            },
          },
          { type: "wait", ms: 200 },
          { type: "screenshot", label: "04-test-deck-listed" },
        ]);
        await ctx.page.keyboard.press("Escape");

        for (let i = 0; i < scenarios.length; i += 1) {
          const scenario = scenarios[i];
          await runSteps([
            {
              type: "custom",
              run: async ({ demoTarget, wait }) => {
                await openTestDeckListbox(demoTarget, wait);
              },
            },
          ]);
          const popover = ctx.demoTarget.locator(".gds-listbox-popover");
          await popover.getByText(scenario.label, { exact: true }).first()
            .click();
          await clickTestBotRun(ctx.demoTarget);
          await runSteps([
            {
              type: "wait-for",
              selector: '[data-testid="testbot-status"]',
              text: "Completed",
              timeoutMs: 180_000,
            },
            { type: "wait", ms: 200 },
            { type: "screenshot", label: `04-test-deck-run-${i + 1}` },
          ]);
        }

        await runSteps([
          { type: "click", selector: '[data-testid="nav-grade"]' },
          { type: "wait-for", text: "Run a grader" },
          { type: "wait", ms: 400 },
          { type: "screenshot", label: "05-grade-tab" },
          { type: "click", selector: '[data-testid="nav-build"]' },
          { type: "wait-for", selector: '[data-testid="build-chat-input"]' },
          { type: "wait", ms: 400 },
          { type: "screenshot", label: "06-build-tab-return" },
        ]);
      },
      {
        slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
          "gambit-nux-from-scratch-demo",
        iframeTargetPath: "/build",
        prepare: async (paths) => {
          sandboxRoot = path.join(paths.latestDir, SANDBOX_DIR_NAME);
          sandboxDeckPath = await prepareSandboxDeck({
            sourceDeckPath,
            sandboxRoot,
          });
          Deno.env.set("GAMBIT_SIMULATOR_BUILD_BOT_ROOT", sandboxRoot);
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
