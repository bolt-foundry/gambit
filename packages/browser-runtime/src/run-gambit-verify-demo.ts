#!/usr/bin/env -S deno run -A

import * as path from "@std/path";
import { seedVerifyFixture } from "@bolt-foundry/gambit-simulator/src/verify_fixture.ts";
import { runTimelineSteps } from "./automation/timeline.ts";
import { runE2e, waitForPath } from "./e2e/utils.ts";
import { bfmonoRoot } from "./paths.ts";
import type { Frame, Page } from "playwright-core";

const VERIFY_WORKSPACE_ID = "verify-fixture-demo";
const DEFAULT_GAMBIT_BOT_DECK_RELATIVE = "src/decks/gambit-bot/PROMPT.md";
const LIVE_BATCH_SIZE = 3;
const LIVE_BATCH_CONCURRENCY = 1;
const LIVE_BATCH_TIMEOUT_MS = 90_000;

type BatchSnapshot = {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  completedRunIds: Array<string>;
  requestRows: number;
};

async function configureLiveBatch(
  demoTarget: Page | Frame,
): Promise<void> {
  const sizeInput = demoTarget.locator(".verify-number-field input").nth(0);
  const concurrencyInput = demoTarget.locator(".verify-number-field input")
    .nth(1);
  await sizeInput.fill(String(LIVE_BATCH_SIZE));
  await concurrencyInput.fill(String(LIVE_BATCH_CONCURRENCY));
}

async function getBatchSnapshot(
  demoTarget: Page | Frame,
): Promise<BatchSnapshot> {
  return await demoTarget.evaluate(() => {
    const toInt = (value: string | null | undefined): number => {
      if (!value) return 0;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const progressText = document.querySelector(".verify-progress-row")
      ?.textContent ?? "";
    const readProgress = (label: string): number => {
      const pattern = new RegExp(`${label}:\\s*(\\d+)`, "i");
      const match = progressText.match(pattern);
      return toInt(match?.[1]);
    };

    const rows = Array.from(document.querySelectorAll(".verify-request-row"));
    const completedRunIds: Array<string> = [];
    let queuedFromRows = 0;
    let runningFromRows = 0;
    let completedFromRows = 0;
    let failedFromRows = 0;
    for (const row of rows) {
      const statusText = row.querySelector(".gds-badge")?.textContent
        ?.trim()
        .toLowerCase() ?? row.textContent?.toLowerCase() ?? "";
      const runId = row.querySelector("a, code")?.textContent?.trim() ?? "";
      if (statusText.includes("queued")) queuedFromRows += 1;
      if (statusText.includes("running")) runningFromRows += 1;
      if (statusText.includes("completed")) {
        completedFromRows += 1;
        if (runId) completedRunIds.push(runId);
      }
      if (statusText.includes("error")) failedFromRows += 1;
    }

    const queued = readProgress("Queued") || queuedFromRows;
    const running = readProgress("Running") || runningFromRows;
    const completed = readProgress("Completed") || completedFromRows;
    const failed = readProgress("Failed") || failedFromRows;

    return {
      queued,
      running,
      completed,
      failed,
      completedRunIds,
      requestRows: rows.length,
    };
  });
}

async function waitForLiveBatchCompletion(
  demoTarget: Page | Frame,
  wait: (ms: number) => Promise<void>,
  expectedRequests: number,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < LIVE_BATCH_TIMEOUT_MS) {
    const snapshot = await getBatchSnapshot(demoTarget);
    if (snapshot.failed > 0) {
      throw new Error(
        `Verify batch reported failed requests (failed=${snapshot.failed}, completed=${snapshot.completed}).`,
      );
    }
    const done = snapshot.requestRows >= expectedRequests &&
      snapshot.queued === 0 &&
      snapshot.running === 0 &&
      snapshot.completed >= expectedRequests;
    if (done) {
      const invalidRunIds = snapshot.completedRunIds.filter((runId) =>
        !runId.startsWith("cal-")
      );
      if (invalidRunIds.length > 0) {
        throw new Error(
          `Verify batch did not produce fresh calibration run IDs: ${
            invalidRunIds.join(", ")
          }`,
        );
      }
      return;
    }
    await wait(500);
  }
  throw new Error(
    `Timed out waiting for live verify batch completion after ${LIVE_BATCH_TIMEOUT_MS}ms.`,
  );
}

async function main(): Promise<void> {
  const repoRoot = bfmonoRoot;
  const gambitPackageRoot = path.resolve(repoRoot, "packages", "gambit");
  const deckPath = path.resolve(
    gambitPackageRoot,
    DEFAULT_GAMBIT_BOT_DECK_RELATIVE,
  );
  const previousVerifyFlag = Deno.env.get("GAMBIT_SIMULATOR_VERIFY_TAB");

  try {
    Deno.env.set("GAMBIT_SIMULATOR_VERIFY_TAB", "1");
    await seedVerifyFixture({
      deckPath,
      workspaceId: VERIFY_WORKSPACE_ID,
      sessionsRoot: path.join(gambitPackageRoot, ".gambit", "workspaces"),
    });

    await runE2e(
      "gambit verify tab demo",
      async (ctx) => {
        const { demoTarget, wait } = ctx;

        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            pathname === `/workspaces/${VERIFY_WORKSPACE_ID}/verify`,
          15_000,
        );

        await runTimelineSteps(ctx, [
          { type: "wait-for", selector: '[data-testid="nav-verify"]' },
          { type: "wait-for", selector: ".verify-status-row" },
          { type: "wait", ms: 500 },
          { type: "screenshot", label: "01-verify-entry" },
        ]);

        await runTimelineSteps(ctx, [
          {
            type: "custom",
            run: async ({ demoTarget }) => {
              const scenarioTrigger = demoTarget
                .locator(".verify-controls .gds-listbox-trigger")
                .first();
              await scenarioTrigger.click();
              const option = demoTarget
                .locator(".gds-listbox-popover .gds-listbox-option")
                .filter({ hasText: "Current workspace context" })
                .first();
              await option.click();
            },
          },
          {
            type: "custom",
            run: async ({ demoTarget }) => {
              await configureLiveBatch(demoTarget);
            },
          },
          {
            type: "click",
            selector: 'button:has-text("Run consistency batch")',
          },
          { type: "wait-for", selector: ".verify-request-row:nth-child(1)" },
          {
            type: "custom",
            run: async ({ demoTarget, wait }) => {
              await waitForLiveBatchCompletion(
                demoTarget,
                wait,
                LIVE_BATCH_SIZE,
              );
            },
          },
          { type: "wait", ms: 1200 },
          { type: "screenshot", label: "02-verify-batch-live-completed" },
        ]);

        await runTimelineSteps(ctx, [
          {
            type: "wait-for",
            selector:
              ".verify-outlier-card:nth-child(1) .verify-outlier-links a:nth-child(1)",
            timeoutMs: 20_000,
          },
          {
            type: "click",
            selector:
              ".verify-outlier-card:nth-child(1) .verify-outlier-links a:nth-child(1)",
          },
        ]);
        await waitForPath(
          demoTarget,
          wait,
          (pathname) => /^\/workspaces\/[^/]+\/grade\/[^/]+$/.test(pathname),
          20_000,
        );
        await runTimelineSteps(ctx, [
          { type: "wait", ms: 400 },
          { type: "screenshot", label: "03-verify-evidence-grade" },
        ]);

        await runTimelineSteps(ctx, [
          { type: "click", selector: '[data-testid="nav-verify"]' },
        ]);
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            pathname === `/workspaces/${VERIFY_WORKSPACE_ID}/verify`,
          15_000,
        );

        await runTimelineSteps(ctx, [
          {
            type: "custom",
            run: async ({ demoTarget }) => {
              const drawer = demoTarget.locator(".workbench-drawer-docked");
              if (
                await drawer.count() > 0 && await drawer.first().isVisible()
              ) {
                return;
              }
              await demoTarget.locator('[data-testid="nav-workbench"]').click();
            },
          },
          { type: "wait-for", selector: ".workbench-drawer-docked" },
          { type: "wait", ms: 400 },
          { type: "screenshot", label: "04-verify-build-assistant" },
        ]);
      },
      {
        slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
          "gambit-verify-demo",
        iframeTargetPath: `/workspaces/${VERIFY_WORKSPACE_ID}/verify`,
        server: {
          port: 8000,
          cwd: gambitPackageRoot,
          command: (targetPort: number) => [
            "deno",
            "run",
            "-A",
            "src/cli.ts",
            "serve",
            deckPath,
            "--bundle",
            "--port",
            String(targetPort),
          ],
        },
      },
    );
  } finally {
    if (previousVerifyFlag === undefined) {
      Deno.env.delete("GAMBIT_SIMULATOR_VERIFY_TAB");
    } else {
      Deno.env.set("GAMBIT_SIMULATOR_VERIFY_TAB", previousVerifyFlag);
    }
  }
}

if (import.meta.main) {
  await main();
}
