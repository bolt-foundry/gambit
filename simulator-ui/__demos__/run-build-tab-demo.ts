#!/usr/bin/env -S deno run -A
// Shortcut: `bft gambit-demo:build-tab`

import * as path from "@std/path";
import {
  currentPath,
  runE2e,
  waitForPath,
} from "../../../demo-runner/src/e2e/utils.ts";
import { DemoServerError } from "../../../demo-runner/src/runner.ts";
import { createTestTabDemoFixture } from "./fixtures/test-tab-fixture.ts";

async function runWithTempServeRoot(
  fn: (serveRoot: string) => Promise<void>,
): Promise<void> {
  const serveRoot = await Deno.makeTempDir({
    prefix: "gambit-build-tab-demo-serve-root-",
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
      "gambit build tab demo",
      async ({ demoTarget, screenshot, wait }) => {
        const normalizeWorkspacePath = (pathname: string): string => {
          return pathname.startsWith("/isograph/")
            ? pathname.slice("/isograph".length)
            : pathname;
        };
        const isWorkspaceBuildPath = (pathname: string): boolean =>
          /^\/workspaces\/[^/]+\/build(?:\/.*)?$/.test(
            normalizeWorkspacePath(pathname),
          );

        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            pathname === "/" ||
            pathname === "/isograph" ||
            pathname === "/isograph/" ||
            pathname === "/workspaces" ||
            pathname === "/workspaces/new" ||
            pathname === "/isograph/workspaces" ||
            pathname === "/isograph/workspaces/new" ||
            isWorkspaceBuildPath(pathname),
          5_000,
          { label: "simulator load", logEveryMs: 250 },
        );

        const createWorkspaceCta = demoTarget.locator(
          '[data-testid="workspace-create-cta"]',
        );
        if (await createWorkspaceCta.count() > 0) {
          await createWorkspaceCta.first().waitFor({
            timeout: 10_000,
          });
          await createWorkspaceCta.first().click();
        } else {
          await demoTarget.locator('[data-testid="nav-workspaces"]').waitFor({
            timeout: 10_000,
          });
          await demoTarget.locator('[data-testid="nav-workspaces"]').click();
          await waitForPath(
            demoTarget,
            wait,
            (pathname) =>
              pathname === "/workspaces" ||
              pathname === "/workspaces/new" ||
              pathname === "/isograph/workspaces" ||
              pathname === "/isograph/workspaces/new",
            10_000,
            { label: "workspaces landing", logEveryMs: 250 },
          );
          await demoTarget.locator('[data-testid="workspace-create-cta"]')
            .waitFor({
              timeout: 10_000,
            });
          await demoTarget.locator('[data-testid="workspace-create-cta"]')
            .click();
        }

        const buildPath = await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceBuildPath(pathname),
          10_000,
          { label: "build tab load", logEveryMs: 250 },
        );
        await screenshot("01-build-tab");

        await demoTarget.locator('[data-testid="build-chat-input"]').waitFor({
          timeout: 10_000,
        });
        const chatPrompt = "hi";
        const workspacePrompt = "what's in our workspace";
        const promptMdPrompt = "what is prompt.md";
        const updateModelPrompt =
          "please update the root PROMPT.md model to openai/gpt-5.1-chat";
        const followupPrompt = `demo build-tab send ${Date.now()}`;
        await demoTarget.locator('[data-testid="build-chat-input"]').fill(
          chatPrompt,
        );
        await demoTarget.locator('[data-testid="build-send"]').click();
        await demoTarget.locator('.imessage-bubble[title="user"]', {
          hasText: chatPrompt,
        }).waitFor({
          timeout: 5_000,
        });
        await demoTarget.locator(".workbench-accordion-title .badge", {
          hasText: "Running",
        }).waitFor({
          timeout: 5_000,
        });
        await demoTarget.locator('[data-testid="build-chat-input"]').fill(
          workspacePrompt,
        );
        await demoTarget.locator('[data-testid="build-send"]').click();
        await demoTarget.locator('.imessage-bubble[title="user"]', {
          hasText: workspacePrompt,
        }).waitFor({
          timeout: 5_000,
        });
        await demoTarget.locator('[data-testid="build-chat-input"]').fill(
          promptMdPrompt,
        );
        await demoTarget.locator('[data-testid="build-send"]').click();
        await demoTarget.locator('.imessage-bubble[title="user"]', {
          hasText: promptMdPrompt,
        }).waitFor({
          timeout: 5_000,
        });
        await demoTarget.locator(
          ".build-files-preview-selector .gds-listbox-trigger",
        ).click();
        await demoTarget.locator(".gds-listbox-popover").waitFor({
          timeout: 5_000,
        });
        await demoTarget.locator(
          '.gds-listbox-option:has-text("PROMPT.md"):not(:has(.gds-listbox-option-meta))',
        ).click();
        await demoTarget.locator(".build-files-preview-header", {
          hasText: "PROMPT.md",
        }).waitFor({
          timeout: 5_000,
        });
        const refreshMarker = `refresh-marker-${Date.now()}`;
        await demoTarget.locator('[data-testid="build-chat-input"]').fill(
          `${updateModelPrompt} and include a single line "${refreshMarker}"`,
        );
        await demoTarget.locator('[data-testid="build-send"]').click();
        await demoTarget.locator('.imessage-bubble[title="user"]', {
          hasText: "please update the root PROMPT.md model",
        }).waitFor({
          timeout: 5_000,
        });
        await demoTarget.locator(".build-file-preview", {
          hasText: "openai/gpt-5.1-chat",
        }).waitFor({
          timeout: 120_000,
        });
        await demoTarget.locator(".build-file-preview", {
          hasText: refreshMarker,
        }).waitFor({
          timeout: 120_000,
        });
        await demoTarget.locator('[data-testid="build-chat-input"]').fill(
          followupPrompt,
        );
        await demoTarget.locator('[data-testid="build-send"]').click();
        await demoTarget.locator('.imessage-bubble[title="user"]', {
          hasText: followupPrompt,
        }).waitFor({
          timeout: 5_000,
        });
        await demoTarget.locator('.imessage-bubble[title="assistant"]').first()
          .waitFor({
            timeout: 20_000,
          })
          .catch(() => {});
        await screenshot("02-build-tab-optimistic-running");
        await demoTarget.locator('[data-testid="build-stop"]').waitFor({
          timeout: 5_000,
        });
        await demoTarget.locator('[data-testid="build-stop"]').click();
        await demoTarget.locator(".workbench-accordion-title .badge", {
          hasText: "Canceled",
        }).waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator(
          '[data-testid="build-chat-input"]:not([disabled])',
        ).waitFor({
          timeout: 20_000,
        });
        const chatDraftAfterSend = await demoTarget.evaluate(() => {
          const input = globalThis.document.querySelector(
            '[data-testid="build-chat-input"]',
          ) as HTMLTextAreaElement | null;
          return input?.value ?? "";
        });
        if (chatDraftAfterSend.trim().length > 0) {
          throw new Error("Expected chat draft to clear after send.");
        }
        await demoTarget.locator('.imessage-bubble[title="user"]', {
          hasText: followupPrompt,
        }).waitFor({
          timeout: 5_000,
        });
        await screenshot("03-build-tab-after-stop");

        const finalPath = await currentPath(demoTarget);
        if (finalPath !== buildPath && !finalPath.startsWith(`${buildPath}/`)) {
          throw new Error(
            `Unexpected final path. Expected ${buildPath}, got ${finalPath}`,
          );
        }

        // keep this here
        await wait(5_000);
      },
      {
        slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
          "gambit-build-tab-demo",
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
