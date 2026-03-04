#!/usr/bin/env -S deno run -A
// Shortcut: `bft gambit-demo:verify-tab`

import * as path from "@std/path";
import { runE2e, waitForPath } from "../../../demo-runner/src/e2e/utils.ts";
import { DemoServerError } from "../../../demo-runner/src/runner.ts";
import { createTestTabDemoFixture } from "./fixtures/test-tab-fixture.ts";

async function runWithTempServeRoot(
  fn: (serveRoot: string) => Promise<void>,
): Promise<void> {
  const serveRoot = await Deno.makeTempDir({
    prefix: "gambit-verify-tab-demo-serve-root-",
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
      "gambit verify tab demo",
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
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            /^\/isograph\/workspaces\/[^/]+\/build(?:\/.*)?$/.test(pathname),
          20_000,
          { label: "build tab load", logEveryMs: 250 },
        );
        await screenshot("01-verify-build-tab");

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
          .waitFor({ timeout: 10_000 });
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

        await demoTarget.locator('[data-testid="nav-verify"]').waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator('[data-testid="nav-verify"]').click();
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            /^\/isograph\/workspaces\/[^/]+\/verify$/.test(pathname),
          10_000,
          { label: "verify tab load", logEveryMs: 250 },
        );

        await demoTarget.locator('[data-testid="verify-tab-scaffold"]').waitFor(
          {
            timeout: 10_000,
          },
        );
        await screenshot("02-verify-tab-loaded");

        const batchSizeInput = demoTarget.locator(
          'label.verify-number-field:has-text("Batch size") input',
        ).first();
        await batchSizeInput.fill("4");
        const concurrencyInput = demoTarget.locator(
          'label.verify-number-field:has-text("Concurrency") input',
        ).first();
        await concurrencyInput.fill("2");

        await demoTarget.locator('[data-testid="verify-run-batch"]').waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator(
          '[data-testid="verify-run-batch"]:not([disabled])',
        )
          .waitFor({ timeout: 10_000 });
        await demoTarget.locator(
          '[data-testid="verify-run-batch"]:not([disabled])',
        )
          .click();

        const requestRows = demoTarget.locator(
          '.verify-section:has(strong:has-text("Batch requests")) .verify-request-row',
        );
        const requestRowDeadline = Date.now() + 240_000;
        let sawRequestRows = false;
        while (Date.now() < requestRowDeadline) {
          const rowCount = await requestRows.count();
          if (rowCount > 0) {
            sawRequestRows = true;
            break;
          }
          const errorText = await demoTarget.locator(".error").first()
            .textContent()
            .catch(() => null);
          if (typeof errorText === "string" && errorText.trim().length > 0) {
            throw new Error(`Verify tab error surfaced: ${errorText.trim()}`);
          }
          await wait(500);
        }
        if (!sawRequestRows) {
          throw new Error("Verify batch requests never rendered.");
        }

        const completionDeadline = Date.now() + 240_000;
        let complete = false;
        while (Date.now() < completionDeadline) {
          const statuses = await requestRows.locator(".badge").allTextContents()
            .catch(() => [] as Array<string>);
          if (
            statuses.length > 0 &&
            statuses.every((status) => {
              const normalized = status.trim().toLowerCase();
              return normalized === "completed" || normalized === "error";
            })
          ) {
            complete = true;
            break;
          }
          await wait(500);
        }
        if (!complete) {
          throw new Error(
            "Verify batch requests did not reach terminal status.",
          );
        }
        await screenshot("03-verify-batch-complete");

        const firstRunLink = requestRows.locator("a").first();
        if (await firstRunLink.count() > 0) {
          await firstRunLink.click();
          await waitForPath(
            demoTarget,
            wait,
            (pathname) =>
              /^\/isograph\/workspaces\/[^/]+\/grade\/[^/]+$/.test(pathname),
            30_000,
            { label: "verify request grade deep-link", logEveryMs: 500 },
          );
          await screenshot("04-verify-open-grade-run");
        }
      },
      {
        slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
          "gambit-verify-tab-demo",
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
