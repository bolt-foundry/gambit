#!/usr/bin/env -S deno run -A
// Canonical command: `bft browser demo gambit-build-tab`

import * as path from "@std/path";
import {
  currentPath,
  DemoServerError,
  runE2e,
  waitForPath,
} from "@bolt-foundry/demo-runner";
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
    const fixture = await createTestTabDemoFixture(serveRoot, {
      includeBrokenScenario: false,
    });
    await runE2e(
      "gambit build tab demo",
      async ({ demoTarget, screenshot, wait }) => {
        const logBuildComposerState = async (
          label: string,
        ): Promise<void> => {
          const snapshot = await demoTarget.evaluate((stepLabel) => {
            const select = (selector: string) => {
              const element = globalThis.document.querySelector(selector);
              if (!(element instanceof HTMLElement)) return null;
              const rect = element.getBoundingClientRect();
              return {
                selector,
                text: element.innerText,
                value: element instanceof HTMLTextAreaElement ||
                    element instanceof HTMLInputElement
                  ? element.value
                  : null,
                disabled: "disabled" in element
                  ? Boolean(
                    (element as HTMLButtonElement | HTMLTextAreaElement)
                      .disabled,
                  )
                  : null,
                ariaDisabled: element.getAttribute("aria-disabled"),
                hidden: element.hidden,
                display: globalThis.getComputedStyle(element).display,
                visibility: globalThis.getComputedStyle(element).visibility,
                opacity: globalThis.getComputedStyle(element).opacity,
                width: rect.width,
                height: rect.height,
              };
            };
            return {
              label: stepLabel,
              path: globalThis.location.pathname,
              buttons: Array.from(
                globalThis.document.querySelectorAll("button"),
              ).map((element) => ({
                testId: element.getAttribute("data-testid"),
                text: element.innerText,
                disabled: element.disabled,
              })),
              buildStart: select('[data-testid="build-start"]'),
              buildSend: select('[data-testid="build-send"]'),
              buildStop: select('[data-testid="build-stop"]'),
              buildInput: select('[data-testid="build-chat-input"]'),
              loadingWorkspaceTab:
                globalThis.document.querySelector(".editor-status")
                  ?.textContent ??
                  null,
            };
          }, label);
          Deno.stdout.writeSync(
            new TextEncoder().encode(
              `[build-demo-state] ${JSON.stringify(snapshot)}\n`,
            ),
          );
        };

        const waitForBuildTabReady = async (): Promise<void> => {
          const loadingWorkspaceTab = demoTarget.locator(".editor-status", {
            hasText: "Loading workspace tab",
          });
          if (await loadingWorkspaceTab.count() > 0) {
            await loadingWorkspaceTab.first().waitFor({
              state: "hidden",
              timeout: 60_000,
            });
          }
          await demoTarget.locator(
            '[data-testid="build-chat-input"]:not([disabled])',
          ).waitFor({
            timeout: 30_000,
          });
          await logBuildComposerState("after-build-tab-ready");
        };

        const waitForBuildComposerIdle = async (
          label: string,
        ): Promise<void> => {
          const idleStart = Date.now();
          while (Date.now() - idleStart < 120_000) {
            const composerState = await demoTarget.evaluate(() => {
              const stopButton = globalThis.document.querySelector(
                '[data-testid="build-stop"]',
              );
              const input = globalThis.document.querySelector(
                '[data-testid="build-chat-input"]',
              );
              const startButton = globalThis.document.querySelector(
                '[data-testid="build-start"]',
              );
              const sendButton = globalThis.document.querySelector(
                '[data-testid="build-send"]',
              );
              const isEnabledButton = (element: Element | null): boolean =>
                element instanceof HTMLButtonElement && !element.disabled;
              return {
                stopVisible: stopButton instanceof HTMLElement &&
                  stopButton.offsetParent !== null,
                inputEnabled: input instanceof HTMLTextAreaElement &&
                  !input.disabled,
                startEnabled: isEnabledButton(startButton),
                sendEnabled: isEnabledButton(sendButton),
              };
            });
            if (
              !composerState.stopVisible &&
              composerState.inputEnabled
            ) {
              return;
            }
            await wait(250);
          }
          await logBuildComposerState(`idle-timeout:${label}`);
          await screenshot(`build-idle-timeout-${label}`);
          throw new Error(
            `Timed out waiting for build composer to become idle: ${label}`,
          );
        };

        const sendBuildPrompt = async (
          prompt: string,
        ): Promise<void> => {
          const userBubbles = demoTarget.locator(
            '.imessage-bubble[title="user"]',
          );
          await waitForBuildComposerIdle(prompt);
          const userBubbleCountBefore = await userBubbles.count();
          await demoTarget.locator('[data-testid="build-chat-input"]').fill(
            prompt,
          );
          const actionButton = demoTarget.locator(
            [
              '[data-testid="build-start"]:not([disabled])',
              '[data-testid="build-send"]:not([disabled])',
            ].join(", "),
          ).first();
          await logBuildComposerState(`before-action:${prompt}`);
          const actionButtonCount = await actionButton.count();
          if (actionButtonCount > 0) {
            await actionButton.waitFor({
              timeout: 120_000,
            }).catch(async (error) => {
              await logBuildComposerState(`timeout:${prompt}`);
              await screenshot("build-send-timeout");
              throw error;
            });
            await actionButton.click();
          } else {
            await demoTarget.locator('[data-testid="build-chat-input"]')
              .press("Enter");
          }
          await demoTarget.locator('[data-testid="build-chat-input"]')
            .evaluate(
              (element) => {
                if (!(element instanceof HTMLTextAreaElement)) {
                  throw new Error("Expected build chat input textarea.");
                }
                return element.value;
              },
            ).then((value) => {
              if (typeof value !== "string") {
                throw new Error("Expected build chat input value.");
              }
            });
          const acceptedStart = Date.now();
          while (Date.now() - acceptedStart < 20_000) {
            const currentUserBubbleCount = await userBubbles.count();
            const draftValue = await demoTarget.locator(
              '[data-testid="build-chat-input"]',
            ).evaluate((element) =>
              element instanceof HTMLTextAreaElement ? element.value : ""
            );
            if (
              currentUserBubbleCount > userBubbleCountBefore ||
              draftValue.trim().length === 0
            ) {
              return;
            }
            await wait(250);
          }
          throw new Error(
            `Timed out waiting for build prompt to be accepted: ${prompt}`,
          );
        };

        const normalizeWorkspacePath = (pathname: string): string => pathname;
        const isWorkspaceBuildPath = (pathname: string): boolean =>
          /^\/workspaces\/[^/]+\/build(?:\/.*)?$/.test(
            normalizeWorkspacePath(pathname),
          );

        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            pathname === "/" ||
            pathname === "/workspaces" ||
            pathname === "/workspaces/new" ||
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
              pathname === "/workspaces/new",
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
        await waitForBuildTabReady();
        const chatPrompt = "hi";
        const workspacePrompt = "what's in our workspace";
        const promptMdPrompt = "what is prompt.md";
        const updateModelPrompt =
          "please update the root PROMPT.md model to openai/gpt-5.1-chat";
        const followupPrompt = `demo build-tab send ${Date.now()}`;
        await sendBuildPrompt(chatPrompt);
        await demoTarget.locator(".workbench-accordion-title .badge", {
          hasText: "Running",
        }).waitFor({
          timeout: 5_000,
        });
        await sendBuildPrompt(workspacePrompt);
        await sendBuildPrompt(promptMdPrompt);
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
        await sendBuildPrompt(
          `${updateModelPrompt} and include a single line "${refreshMarker}"`,
        );
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
        await sendBuildPrompt(followupPrompt);
        await demoTarget.locator('.imessage-bubble[title="assistant"]')
          .first()
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
        if (
          finalPath !== buildPath && !finalPath.startsWith(`${buildPath}/`)
        ) {
          throw new Error(
            `Unexpected final path. Expected ${buildPath}, got ${finalPath}`,
          );
        }

        // keep this here
        await wait(5_000);
      },
      {
        mode: "demo",
        slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
          "gambit-build-tab-demo",
        iframeTargetPath: "/",
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
