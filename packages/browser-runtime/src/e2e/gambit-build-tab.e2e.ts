import * as path from "@std/path";
import {
  runE2e,
  waitForPath,
} from "@bolt-foundry/browser-runtime/src/e2e/utils.ts";
import { ensureWorkspaceBuildPath } from "@bolt-foundry/gambit-simulator/simulator-ui/__demos__/flows/workspace-tab-flows.ts";
import { bfmonoRoot } from "@bolt-foundry/browser-runtime/src/paths.ts";

const DEFAULT_NUX_DEMO_DECK_RELATIVE =
  "src/decks/demo/nux_from_scratch/root.deck.md";

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

async function waitForBuildTabReady(
  demoTarget: Parameters<typeof ensureWorkspaceBuildPath>[0],
): Promise<void> {
  const loadingWorkspaceTab = demoTarget.locator(".editor-status", {
    hasText: "Loading workspace tab",
  });
  if (await loadingWorkspaceTab.count() > 0) {
    await loadingWorkspaceTab.first().waitFor({
      state: "hidden",
      timeout: 60_000,
    });
  }
  await demoTarget.locator('[data-testid="build-chat-input"]:not([disabled])')
    .waitFor({
      timeout: 30_000,
    });
}

Deno.test("gambit build tab renders in demo runner harness", async () => {
  const repoRoot = bfmonoRoot;
  const gambitPackageRoot = path.resolve(
    repoRoot,
    "packages",
    "gambit",
    "packages",
    "gambit-simulator",
  );
  const demoDeckPath = resolveSourceDeckPath({ repoRoot, gambitPackageRoot });
  await runE2e(
    "gambit build tab renders in demo runner harness",
    async ({ demoTarget, screenshot, wait }) => {
      await ensureWorkspaceBuildPath(demoTarget, wait);

      const navBuild = demoTarget.locator('[data-testid="nav-build"]');
      if ((await navBuild.count()) === 0) {
        throw new Error("Build tab nav item not present");
      }

      await waitForBuildTabReady(demoTarget);
      await demoTarget.locator(".build-files-preview-selector .gds-listbox")
        .waitFor();
      await demoTarget.locator(".build-file-preview").waitFor();
      await wait(600);
      await screenshot("build-tab-initial");

      const selectedFilename = await demoTarget
        .locator(".build-files-preview-selector .gds-listbox-trigger")
        .textContent();
      if (!(selectedFilename ?? "").trim()) {
        throw new Error(
          "Expected build file selector to show an active file label.",
        );
      }

      const previewText = await demoTarget
        .locator(".build-file-preview")
        .textContent();
      if (!(previewText ?? "").includes("model =")) {
        throw new Error(
          "Expected build file preview to include deck model params content.",
        );
      }
      await wait(1_000);
      await screenshot("build-tab-preview");

      await demoTarget.locator('[data-testid="nav-test"]').click();
      await waitForPath(
        demoTarget,
        wait,
        (pathname) => /\/workspaces\/[^/]+\/test$/.test(pathname),
      );

      await demoTarget.locator('[data-testid="nav-build"]').click();
      await waitForPath(
        demoTarget,
        wait,
        (pathname) => /\/workspaces\/[^/]+\/build(?:\/.*)?$/.test(pathname),
      );
      await waitForBuildTabReady(demoTarget);
      await wait(500);
      await screenshot("build-tab-return");
    },
    {
      slug: "gambit-build-tab-browser-runtime",
      iframeTargetPath: "/build",
      server: {
        cwd: gambitPackageRoot,
        command: (targetPort: number) => [
          "deno",
          "run",
          "-A",
          "src/cli.ts",
          "serve",
          demoDeckPath,
          "--bundle",
          "--port",
          String(targetPort),
        ],
      },
    },
  );
});
