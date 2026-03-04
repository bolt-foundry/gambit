#!/usr/bin/env -S deno run -A
// Shortcut: `bft gambit-demo:grade-tab`

import * as path from "@std/path";
import { runE2e, waitForPath } from "../../../demo-runner/src/e2e/utils.ts";
import { DemoServerError } from "../../../demo-runner/src/runner.ts";
import { createTestTabDemoFixture } from "./fixtures/test-tab-fixture.ts";

async function runWithTempServeRoot(
  fn: (serveRoot: string) => Promise<void>,
): Promise<void> {
  const serveRoot = await Deno.makeTempDir({
    prefix: "gambit-grade-tab-demo-serve-root-",
  });
  try {
    await fn(serveRoot);
  } finally {
    await Deno.remove(serveRoot, { recursive: true }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const moduleDir = path.dirname(path.fromFileUrl(import.meta.url));
  const repoRoot = path.resolve(moduleDir, "..", "..", "..", "..");
  const gambitPackageRoot = path.resolve(repoRoot, "packages", "gambit");
  const gambitCliPath = path.join(gambitPackageRoot, "src", "cli.ts");

  await runWithTempServeRoot(async (serveRoot) => {
    const fixture = await createTestTabDemoFixture(serveRoot);
    await runE2e(
      "gambit grade tab demo",
      async ({ demoTarget, screenshot, wait }) => {
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            pathname === "/isograph" ||
            pathname === "/isograph/workspaces" ||
            pathname === "/isograph/workspaces/new" ||
            /^\/isograph\/workspaces\/[^/]+\/build(?:\/.*)?$/.test(pathname),
          5_000,
          { label: "simulator load", logEveryMs: 250 },
        );

        await demoTarget.locator('[data-testid="nav-workspaces"]').waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator('[data-testid="nav-workspaces"]').click();
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            pathname === "/isograph/workspaces" ||
            pathname === "/isograph/workspaces/new",
          5_000,
          { label: "workspaces landing", logEveryMs: 250 },
        );

        await demoTarget.locator('[data-testid="workspace-create-cta"]')
          .click();
        const buildPath = await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            /^\/isograph\/workspaces\/[^/]+\/build(?:\/.*)?$/.test(pathname),
          20_000,
          { label: "build tab load", logEveryMs: 250 },
        );
        await screenshot("01-grade-build-tab");

        await demoTarget.locator('[data-testid="nav-test"]').waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator('[data-testid="nav-test"]').click();
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            /^\/isograph\/workspaces\/[^/]+\/test(?:\/[^/]+)?$/.test(pathname),
          10_000,
          { label: "test tab load", logEveryMs: 250 },
        );
        await demoTarget.locator('[data-testid="testbot-run"]').waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator('[data-testid="testbot-run"]:not([disabled])')
          .waitFor({
            timeout: 10_000,
          });
        await demoTarget.locator('[data-testid="testbot-run"]:not([disabled])')
          .click();
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            /^\/isograph\/workspaces\/[^/]+\/test\/[^/]+$/.test(pathname),
          30_000,
          { label: "test run start", logEveryMs: 500 },
        );

        await demoTarget.locator('[data-testid="nav-grade"]').waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator('[data-testid="nav-grade"]').click();
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            /^\/isograph\/workspaces\/[^/]+\/grade(?:\/[^/]+)?$/.test(pathname),
          10_000,
          { label: "grade tab load", logEveryMs: 250 },
        );
        await demoTarget.locator('[data-testid="grade-run-grader"]').waitFor({
          timeout: 10_000,
        });
        await screenshot("02-grade-tab-loaded");

        await demoTarget.locator('[data-testid="grade-run-grader"]').click();
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            /^\/isograph\/workspaces\/[^/]+\/grade\/[^/]+$/.test(pathname),
          60_000,
          { label: "grade run deep-link", logEveryMs: 500 },
        );

        await demoTarget.locator('[data-testid^="grade-run-"]').first().waitFor(
          { timeout: 15_000 },
        );
        await screenshot("03-grade-run-created");

        const firstRunCard = demoTarget.locator(
          '[data-testid^="grade-run-"]:not([data-testid="grade-run-grader"])',
        ).first();
        const runBody = firstRunCard.locator(".calibrate-run-body").first();
        const runBodyVisible = await runBody.isVisible().catch(() => false);
        if (!runBodyVisible) {
          await firstRunCard.locator(".calibrate-run-header").first().click();
        }
        await runBody.waitFor({ timeout: 15_000 });
        await runBody.locator('button:has-text("Flag")').first().waitFor({
          timeout: 90_000,
        });
        await runBody.locator('button:has-text("Flag")').first().click();
        await runBody.locator('button:has-text("Flagged")').first().waitFor(
          { timeout: 10_000 },
        );

        const runReason = runBody.locator("textarea").first();
        await runReason.fill("Demo flag reason.");
        await runReason.blur();
        await runReason.waitFor({ timeout: 10_000 });
        await screenshot("04-grade-flagged");

        await runBody.locator('button:has-text("Flagged")').first().click();
        await runBody.locator('button:has-text("Flag")').first().waitFor({
          timeout: 10_000,
        });
        await screenshot("05-grade-unflagged");

        const finalPath = await demoTarget.evaluate(() =>
          globalThis.location.pathname
        );
        if (!/^\/isograph\/workspaces\/[^/]+\/grade\/[^/]+$/.test(finalPath)) {
          throw new Error(
            `Unexpected final path: ${finalPath}; initial build path ${buildPath}`,
          );
        }
      },
      {
        slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
          "gambit-grade-tab-demo",
        iframeTargetPath: "/isograph",
        server: {
          cwd: serveRoot,
          command: (targetPort: number) => [
            "deno",
            "run",
            "-A",
            gambitCliPath,
            "serve",
            fixture.rootDeckPath,
            "--yolo",
            "--bundle",
            "--sourcemap",
            "--port",
            String(targetPort),
          ],
        },
      },
    );
  });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof DemoServerError) {
      Deno.stderr.writeSync(new TextEncoder().encode(`${error.message}\n`));
      Deno.exit(error.exitCode);
    }
    throw error;
  }
}
