#!/usr/bin/env -S deno run -A
// Shortcut: `bft gambit-demo:full`

import * as path from "@std/path";
import {
  currentPath,
  runE2e,
  waitForPath,
} from "../../../demo-runner/src/e2e/utils.ts";
import { DemoServerError } from "../../../demo-runner/src/runner.ts";
import { createTestTabDemoFixture } from "./fixtures/test-tab-fixture.ts";
import {
  ensureWorkspaceBuildPath,
  runBuildSmokeFlow,
  runGradeSmokeFlow,
  runTestSmokeFlow,
  runVerifySmokeFlow,
} from "./flows/workspace-tab-flows.ts";

async function runWithTempServeRoot(
  fn: (serveRoot: string) => Promise<void>,
): Promise<void> {
  const serveRoot = await Deno.makeTempDir({
    prefix: "gambit-demo-serve-root-",
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
    const fixture = await createTestTabDemoFixture(serveRoot, {
      includeBrokenScenario: false,
    });
    await runE2e(
      "gambit full demo",
      async ({ demoTarget, screenshot, wait }) => {
        const buildPath = await ensureWorkspaceBuildPath(demoTarget, wait);
        await screenshot("01-build-tab");

        await runBuildSmokeFlow(demoTarget);
        await screenshot("02-build-tab-running");
        await screenshot("03-build-tab-after-stop");

        const { testPath, testRunPath } = await runTestSmokeFlow(
          demoTarget,
          wait,
        );
        await screenshot("04-test-tab");

        if (!buildPath.startsWith("/isograph/workspaces/")) {
          throw new Error(`Unexpected build path: ${buildPath}`);
        }
        if (!testPath.startsWith("/isograph/workspaces/")) {
          throw new Error(`Unexpected test path: ${testPath}`);
        }
        if (!testRunPath.startsWith("/isograph/workspaces/")) {
          throw new Error(`Unexpected test run path: ${testRunPath}`);
        }

        const gradeRunPath = await runGradeSmokeFlow(demoTarget, wait);
        await screenshot("05-grade-tab");
        if (!gradeRunPath.startsWith("/isograph/workspaces/")) {
          throw new Error(`Unexpected grade run path: ${gradeRunPath}`);
        }

        const verifyPath = await runVerifySmokeFlow(demoTarget, wait);
        await screenshot("06-verify-tab-loaded");
        await screenshot("07-verify-batch-complete");

        const verifyFinalPath = await currentPath(demoTarget);
        if (verifyFinalPath !== verifyPath) {
          throw new Error(
            `Expected verify path ${verifyPath}, got ${verifyFinalPath}`,
          );
        }

        // Navigate back to grade to prove grade deep-link route still works after verify flow.
        await demoTarget.locator('[data-testid="nav-grade"]').waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator('[data-testid="nav-grade"]').click();
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            /^\/isograph\/workspaces\/[^/]+\/grade(?:\/[^/]+)?$/.test(pathname),
          15_000,
          { label: "grade return", logEveryMs: 250 },
        );
        await screenshot("08-grade-tab-return");

        await wait(2_000);
      },
      {
        slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() || "gambit-full-demo",
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
