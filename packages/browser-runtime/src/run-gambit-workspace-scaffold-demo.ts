#!/usr/bin/env -S deno run -A

import * as path from "@std/path";
import { runTimelineSteps } from "./automation/timeline.ts";
import { runE2e, waitForPath } from "./e2e/utils.ts";
import { bfmonoRoot } from "./paths.ts";
import type { DemoScenarioContext } from "./runner.ts";

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
    `Workspace scaffold demo could not find listbox option: ${label}${
      opts?.fallbackLabel ? ` (fallback: ${opts.fallbackLabel})` : ""
    }`,
  );
}

async function main(): Promise<void> {
  const repoRoot = bfmonoRoot;
  const gambitPackageRoot = path.resolve(repoRoot, "packages", "gambit");
  await runE2e(
    "gambit workspace scaffold demo",
    async (ctx) => {
      const { demoTarget, wait } = ctx;
      await waitForPath(
        demoTarget,
        wait,
        (pathname) =>
          /\/workspaces\/[^/]+\/build$/.test(pathname) ||
          pathname === "/build",
      );

      await runTimelineSteps(
        ctx,
        [
          { type: "wait-for", selector: '[data-testid="nav-build"]' },
          { type: "click", selector: '[data-testid="nav-build"]' },
          { type: "wait-for", selector: '[data-testid="build-chat-input"]' },
          { type: "wait", ms: 400 },
          { type: "screenshot", label: "01-build-tab" },
        ],
      );

      await runTimelineSteps(
        ctx,
        [
          { type: "wait-for", selector: ".build-files-preview-header" },
          {
            type: "wait-for",
            selector:
              ".build-files-preview-selector .gds-listbox-trigger:not([disabled])",
          },
          {
            type: "click",
            selector: ".build-files-preview-selector .gds-listbox-trigger",
          },
          { type: "wait-for", selector: ".gds-listbox-popover" },
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
          { type: "screenshot", label: "02-build-root" },
        ],
      );

      await runTimelineSteps(
        ctx,
        [
          { type: "click", selector: '[data-testid="nav-test"]' },
          { type: "wait-for", selector: '[data-testid="testbot-run"]' },
          { type: "wait", ms: 400 },
          { type: "screenshot", label: "03-test-tab" },
          {
            type: "custom",
            run: async ({ demoTarget }) => {
              const trigger = demoTarget.locator(
                ".test-bot-sidebar .gds-listbox-trigger",
              );
              if ((await trigger.count()) === 0) {
                const placeholder = await demoTarget
                  .locator(".test-bot-sidebar .placeholder")
                  .first()
                  .textContent()
                  .catch(() => "");
                throw new Error(
                  `No test deck listbox found. ${
                    placeholder
                      ? `Placeholder: ${placeholder.trim()}`
                      : "No placeholder text."
                  }`,
                );
              }
              await trigger.first().click();
            },
          },
          {
            type: "custom",
            run: async ({ demoTarget, wait }) => {
              const popover = demoTarget.locator(".gds-listbox-popover");
              const start = Date.now();
              while (Date.now() - start < 5000) {
                if (await popover.count()) break;
                await wait(100);
              }
              if ((await popover.count()) === 0) {
                throw new Error("Scenario listbox popover did not appear.");
              }
              const option = popover.locator(".gds-listbox-option").first();
              await option.waitFor();
              await option.click();
            },
          },
          {
            type: "custom",
            run: async ({ demoTarget, wait }) => {
              const button = demoTarget.locator(
                '[data-testid="testbot-run"]',
              );
              const start = Date.now();
              while (Date.now() - start < 15_000) {
                if (await button.isEnabled()) return;
                await wait(250);
              }
              const errorText = (await demoTarget
                .locator(".test-bot-sidebar .error")
                .first()
                .textContent()
                .catch(() => ""))?.trim();
              throw new Error(
                `Test bot run button stayed disabled. ${
                  errorText ? `Reason: ${errorText}` : "No error text found."
                }`,
              );
            },
          },
          { type: "click", selector: '[data-testid="testbot-run"]' },
          {
            type: "wait-for",
            selector: '[data-testid="testbot-status"]',
            text: "Completed",
            timeoutMs: 180_000,
          },
          { type: "wait", ms: 400 },
          { type: "screenshot", label: "04-test-complete" },
        ],
      );
    },
    {
      slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
        "gambit-workspace-scaffold-demo",
      iframeTargetPath: "/build",
      server: {
        port: 8000,
        cwd: gambitPackageRoot,
        command: (targetPort: number) => [
          "deno",
          "run",
          "-A",
          "src/cli.ts",
          "serve",
          "--bundle",
          "--port",
          String(targetPort),
        ],
      },
    },
  );
}

if (import.meta.main) {
  await main();
}
