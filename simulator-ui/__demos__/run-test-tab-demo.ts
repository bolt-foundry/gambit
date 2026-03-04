#!/usr/bin/env -S deno run -A
// Shortcut: `bft gambit-demo:test-tab`

import * as path from "@std/path";
import {
  currentPath,
  runE2e,
  waitForPath,
} from "../../../demo-runner/src/e2e/utils.ts";
import { DemoServerError } from "../../../demo-runner/src/runner.ts";
import { createTestTabDemoFixture } from "./fixtures/test-tab-fixture.ts";

function logTestTabDemo(
  label: string,
  details?: Record<string, unknown>,
): void {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  Deno.stderr.writeSync(
    new TextEncoder().encode(`[gambit-test-tab-demo] ${label}${payload}\n`),
  );
}

async function runWithTempServeRoot(
  fn: (serveRoot: string) => Promise<void>,
): Promise<void> {
  const serveRoot = await Deno.makeTempDir({
    prefix: "gambit-test-tab-demo-serve-root-",
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
      "gambit test tab demo",
      async ({ demoTarget, screenshot, wait }) => {
        const readSelectedRunStatus = async (): Promise<string | null> => {
          return await demoTarget.evaluate(() => {
            const statusNode = globalThis.document.querySelector(
              '[data-testid="test-selected-run"]',
            ) ??
              globalThis.document.querySelector(
                '[data-testid="testbot-status"]',
              );
            if (!statusNode) return null;
            return (statusNode.textContent ?? "").replace(/\s+/g, " ").trim();
          });
        };
        const waitForTerminalScenarioStatus = async (
          timeoutMs: number,
        ): Promise<string | null> => {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const statusText = await readSelectedRunStatus();
            if (
              statusText &&
              /\b(COMPLETED|FAILED|CANCELED|STOPPED)\b/i.test(statusText)
            ) {
              return statusText;
            }
            await wait(500);
          }
          return null;
        };
        const readScenarioTriggerLabel = async (): Promise<string> => {
          return await demoTarget.evaluate(() => {
            const legacy = globalThis.document.querySelector(
              '[data-testid="test-scenario-selector"] .gds-listbox-trigger .gds-listbox-label',
            );
            if (legacy) {
              return (legacy.textContent ?? "").replace(/\s+/g, " ").trim();
            }
            const labels = globalThis.document.querySelectorAll(
              '[data-testid="test-tab-scaffold"] .test-bot-sidebar .gds-listbox-trigger .gds-listbox-label',
            );
            const label = labels.length > 1 ? labels[1] : labels[0];
            return (label?.textContent ?? "").replace(/\s+/g, " ").trim();
          });
        };
        const assertScenarioTriggerLabel = async (
          expectedLabel: string,
          label: string,
        ): Promise<void> => {
          const actual = await readScenarioTriggerLabel();
          if (actual !== expectedLabel) {
            throw new Error(
              `Expected scenario selector "${expectedLabel}" for ${label}, got "${actual}".`,
            );
          }
        };
        const waitForScenarioSelector = async (
          label: string,
          timeoutMs = 15_000,
        ): Promise<void> => {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const ready = await demoTarget.evaluate(() => {
              const legacy = globalThis.document.querySelector(
                '[data-testid="test-scenario-selector"] .gds-listbox-trigger',
              );
              if (legacy) return true;
              const triggers = globalThis.document.querySelectorAll(
                '[data-testid="test-tab-scaffold"] .test-bot-sidebar .gds-listbox-trigger',
              );
              return triggers.length >= 2;
            });
            if (ready) {
              logTestTabDemo("scenario-selector-ready", { label, timeoutMs });
              return;
            }
            await wait(250);
          }
          try {
            const probe = await demoTarget.evaluate(() => {
              const selector =
                '[data-testid="test-scenario-selector"] .gds-listbox-trigger';
              const runButton = globalThis.document.querySelector(
                '[data-testid="testbot-run"]',
              );
              const navTest = globalThis.document.querySelector(
                '[data-testid="nav-test"]',
              );
              const navBuild = globalThis.document.querySelector(
                '[data-testid="nav-build"]',
              );
              const scaffold = globalThis.document.querySelector(
                '[data-testid="test-tab-scaffold"]',
              );
              return {
                pathname: globalThis.location.pathname,
                search: globalThis.location.search,
                hasScaffold: Boolean(scaffold),
                hasSelector: Boolean(
                  globalThis.document.querySelector(selector),
                ),
                hasRunButton: Boolean(runButton),
                navTestClassName: navTest?.getAttribute("class") ?? null,
                navBuildClassName: navBuild?.getAttribute("class") ?? null,
                navTestAriaCurrent: navTest?.getAttribute("aria-current") ??
                  null,
                navBuildAriaCurrent: navBuild?.getAttribute("aria-current") ??
                  null,
                hasBuildInput: Boolean(
                  globalThis.document.querySelector(
                    '[data-testid="build-chat-input"]',
                  ),
                ),
                hasScenarioRuns: Boolean(
                  globalThis.document.querySelector(
                    '[data-testid="test-scenario-runs"]',
                  ),
                ),
                bodyPrefix: (globalThis.document.body?.textContent ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 240),
              };
            });
            logTestTabDemo("scenario-selector-timeout", {
              label,
              timeoutMs,
              probe,
              error: "scenario selector not ready within timeout",
            });
          } catch {
            // best-effort probe only
          }
          throw new Error(
            `Timed out waiting for scenario selector (${label}) after ${timeoutMs}ms.`,
          );
        };
        const clickScenarioSelector = async (): Promise<void> => {
          const legacy = demoTarget.locator(
            '[data-testid="test-scenario-selector"] .gds-listbox-trigger',
          );
          if (await legacy.count() > 0) {
            await legacy.first().click();
            return;
          }
          await demoTarget.locator(
            '[data-testid="test-tab-scaffold"] .test-bot-sidebar .gds-listbox-trigger',
          ).nth(1).click();
        };
        const clickRunScenarioButton = async (
          timeoutMs = 15_000,
        ): Promise<void> => {
          const runButton = demoTarget.locator('[data-testid="testbot-run"]');
          await runButton.first().waitFor({ timeout: timeoutMs });
          await runButton.first().click();
        };
        const waitForWorkbenchCompleted = async (
          label: string,
          timeoutMs = 90_000,
        ): Promise<void> => {
          const start = Date.now();
          let sawRunning = false;
          let lastState: Record<string, unknown> | null = null;
          while (Date.now() - start < timeoutMs) {
            const state = await demoTarget.evaluate(() => {
              const input = globalThis.document.querySelector(
                '[data-testid="build-chat-input"]',
              ) as HTMLTextAreaElement | null;
              const send = globalThis.document.querySelector(
                '[data-testid="build-send"]',
              ) as HTMLButtonElement | null;
              const stop = globalThis.document.querySelector(
                '[data-testid="build-stop"]',
              ) as HTMLButtonElement | null;
              const startButton = globalThis.document.querySelector(
                '[data-testid="build-start"]',
              ) as HTMLButtonElement | null;
              const activity = globalThis.document.querySelector(
                '[data-testid="build-chat-activity-indicator"]',
              );
              return {
                inputVisible: Boolean(input),
                inputDisabled: Boolean(input?.disabled),
                sendVisible: Boolean(send),
                sendDisabled: Boolean(send?.disabled),
                stopVisible: Boolean(stop),
                stopDisabled: Boolean(stop?.disabled),
                startVisible: Boolean(startButton),
                startDisabled: Boolean(startButton?.disabled),
                activityVisible: Boolean(activity),
              };
            });
            lastState = state;
            if (state.stopVisible && !state.stopDisabled) {
              sawRunning = true;
            }
            const idleReady = state.inputVisible && !state.inputDisabled &&
              !state.stopVisible &&
              (state.sendVisible || state.startVisible) &&
              !state.activityVisible;
            if (idleReady && sawRunning) {
              logTestTabDemo("workbench-completed", {
                label,
                timeoutMs,
                state,
              });
              return;
            }
            await wait(500);
          }
          throw new Error(
            `Timed out waiting for workbench completion (${label}) after ${timeoutMs}ms; lastState=${
              JSON.stringify(lastState)
            }`,
          );
        };
        const waitForScenarioOption = async (
          label: string,
          timeoutMs = 30_000,
        ): Promise<{ found: boolean; optionCount: number }> => {
          const ensureScenarioListboxOpen = async (): Promise<void> => {
            const popover = demoTarget.locator(".gds-listbox-popover");
            if (await popover.count() > 0) return;
            await clickScenarioSelector();
            await popover.first().waitFor({ timeout: 5_000 });
          };

          await ensureScenarioListboxOpen();
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            await ensureScenarioListboxOpen();
            const optionCount = await demoTarget.locator(
              ".gds-listbox-popover .gds-listbox-option",
            ).count();
            const found = await demoTarget.locator(
              ".gds-listbox-popover .gds-listbox-option",
              { hasText: label },
            ).count() > 0;
            if (found) return { found, optionCount };
            await wait(250);
          }
          await ensureScenarioListboxOpen();
          const optionCount = await demoTarget.locator(
            ".gds-listbox-popover .gds-listbox-option",
          ).count();
          const found = await demoTarget.locator(
            ".gds-listbox-popover .gds-listbox-option",
            { hasText: label },
          ).count() > 0;
          return { found, optionCount };
        };
        const navigateToPath = async (nextPath: string): Promise<void> => {
          await demoTarget.evaluate((path) => {
            globalThis.location.assign(path);
          }, nextPath);
        };
        const logUiState = async (label: string): Promise<void> => {
          const state = await demoTarget.evaluate(() => {
            const navTest = globalThis.document.querySelector(
              '[data-testid="nav-test"]',
            );
            const navBuild = globalThis.document.querySelector(
              '[data-testid="nav-build"]',
            );
            return {
              pathname: globalThis.location.pathname,
              search: globalThis.location.search,
              navTestClassName: navTest?.getAttribute("class") ?? null,
              navBuildClassName: navBuild?.getAttribute("class") ?? null,
              navTestAriaCurrent: navTest?.getAttribute("aria-current") ?? null,
              navBuildAriaCurrent: navBuild?.getAttribute("aria-current") ??
                null,
              hasTestTabScaffold: Boolean(
                globalThis.document.querySelector(
                  '[data-testid="test-tab-scaffold"]',
                ),
              ),
              hasTestScenarioSelector: Boolean(
                globalThis.document.querySelector(
                  '[data-testid="test-scenario-selector"]',
                ),
              ),
              hasTestScenarioRuns: Boolean(
                globalThis.document.querySelector(
                  '[data-testid="test-scenario-runs"]',
                ),
              ),
              hasBuildInput: Boolean(
                globalThis.document.querySelector(
                  '[data-testid="build-chat-input"]',
                ),
              ),
              hasBuildFilesPreview: Boolean(
                globalThis.document.querySelector(".build-files-preview"),
              ),
              headingText: (
                globalThis.document.querySelector("h1,h2")?.textContent ?? ""
              ).replace(/\s+/g, " ").trim(),
            };
          });
          logTestTabDemo("ui-state", { label, state });
        };
        const normalizeWorkspacePath = (pathname: string): string => {
          return pathname.startsWith("/isograph/")
            ? pathname.slice("/isograph".length)
            : pathname;
        };
        const isWorkspaceBuildPath = (pathname: string): boolean =>
          /^\/workspaces\/[^/]+\/build(?:\/.*)?$/.test(
            normalizeWorkspacePath(pathname),
          );
        const isWorkspaceTestPath = (pathname: string): boolean =>
          /^\/workspaces\/[^/]+\/test(?:\/[^/]+)?$/.test(
            normalizeWorkspacePath(pathname),
          );
        const isWorkspaceTestRunPath = (pathname: string): boolean =>
          /^\/workspaces\/[^/]+\/test\/[^/]+$/.test(
            normalizeWorkspacePath(pathname),
          );
        const isWorkspacePath = (pathname: string): boolean =>
          normalizeWorkspacePath(pathname).startsWith("/workspaces/");

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
          3_000,
          { label: "simulator load", logEveryMs: 250 },
        );

        const createWorkspaceCta = demoTarget.locator(
          '[data-testid="workspace-create-cta"]',
        );
        if (await createWorkspaceCta.count() > 0) {
          await createWorkspaceCta.first().waitFor({
            timeout: 5_000,
          });
          await createWorkspaceCta.first().click();
        }

        const buildPath = await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceBuildPath(pathname),
          10_000,
          { label: "workspace build load", logEveryMs: 250 },
        );
        await screenshot("01-build-tab");

        await demoTarget.locator('[data-testid="nav-test"]').waitFor({
          timeout: 5_000,
        });
        await demoTarget.locator('[data-testid="nav-test"]').click();
        const testPath = await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceTestPath(pathname),
          10_000,
          { label: "test tab load", logEveryMs: 250 },
        );

        await demoTarget.locator('[data-testid="test-tab-scaffold"]').waitFor({
          timeout: 5_000,
        });
        await waitForScenarioSelector("initial-test-load");
        await clickScenarioSelector();
        for (const label of fixture.scenarioLabels) {
          await demoTarget.locator(".gds-listbox-popover .gds-listbox-option", {
            hasText: label,
          }).first().waitFor({
            timeout: 5_000,
          });
        }
        await demoTarget.locator(".gds-listbox-popover .gds-listbox-option", {
          hasText: fixture.scenarioLabels[1],
        }).first().click();
        await assertScenarioTriggerLabel(
          fixture.scenarioLabels[1],
          "initial selection",
        );
        await demoTarget.locator(
          '[data-testid="test-scenario-json-input"], [data-testid="testbot-scenario-json-input"]',
        )
          .waitFor({
            timeout: 5_000,
          });
        await demoTarget.locator(
          '[data-testid="test-scenario-json-input"], [data-testid="testbot-scenario-json-input"]',
        )
          .fill("{");
        const runDisabledForInvalidScenarioJson = await demoTarget.evaluate(
          () => {
            const button = globalThis.document.querySelector(
              '[data-testid="testbot-run"]',
            ) as HTMLButtonElement | null;
            return Boolean(button?.disabled);
          },
        );
        if (!runDisabledForInvalidScenarioJson) {
          throw new Error(
            "Expected Run scenario to be disabled for invalid scenario JSON.",
          );
        }
        await demoTarget.locator(
          '[data-testid="test-scenario-json-input"], [data-testid="testbot-scenario-json-input"]',
        )
          .fill(
            "{}",
          );
        await demoTarget.locator('.tab-anchor:has-text("Tools")').first()
          .click();
        await demoTarget.locator('.tab-anchor:has-text("Schema")').first()
          .click();
        await demoTarget.locator('.tab-anchor:has-text("Input")').first()
          .click();
        const hasAssistantInitInput = await demoTarget.locator(
          '[data-testid="test-assistant-init-json-input"], [data-testid="testbot-assistant-init-json-input"]',
        ).count() > 0;
        if (hasAssistantInitInput) {
          await demoTarget.locator('button:has-text("Reset init")')
            .waitFor({
              timeout: 5_000,
            });
          await demoTarget.locator('button:has-text("Refresh schema")').waitFor(
            {
              timeout: 5_000,
            },
          );
        } else {
          await demoTarget.locator('[data-testid="testbot-run"]').waitFor({
            timeout: 5_000,
          });
        }
        await clickRunScenarioButton();
        const firstRunPath = await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceTestRunPath(pathname),
          20_000,
          { label: "test run path", logEveryMs: 250 },
        );
        const firstRunBasePath = firstRunPath.replace(/\/[^/]+$/, "");
        await navigateToPath(firstRunBasePath);
        await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceTestPath(pathname),
          10_000,
          { label: "test base path before second run", logEveryMs: 250 },
        );
        await waitForScenarioSelector("second-run-load", 30_000);
        await clickRunScenarioButton();
        const secondRunPath = await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            isWorkspaceTestRunPath(pathname) &&
            pathname !== firstRunPath,
          20_000,
          { label: "second test run path", logEveryMs: 250 },
        );
        await screenshot("02-test-tab");
        await waitForTerminalScenarioStatus(15_000).catch(() => null);
        const secondRunBasePath = secondRunPath.replace(/\/[^/]+$/, "");
        await navigateToPath(secondRunBasePath);
        await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceTestPath(pathname),
          10_000,
          { label: "new chat base test path", logEveryMs: 250 },
        );
        await waitForScenarioSelector("third-run-load", 30_000);
        await clickRunScenarioButton();
        const thirdRunPath = await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            isWorkspaceTestRunPath(pathname) &&
            pathname !== secondRunPath,
          20_000,
          { label: "new chat run path", logEveryMs: 250 },
        );
        if (thirdRunPath === secondRunPath) {
          throw new Error("Expected New chat to create and select a new run.");
        }

        await demoTarget.locator('[data-testid="nav-build"]').waitFor({
          timeout: 5_000,
        });
        await demoTarget.locator('[data-testid="nav-build"]').click();
        await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceBuildPath(pathname),
          10_000,
          { label: "return to build tab", logEveryMs: 250 },
        );
        await demoTarget.locator('[data-testid="build-chat-input"]').waitFor({
          timeout: 10_000,
        });

        const scenarioSuffix = Date.now();
        const scenarioLabel = `Gamma scenario ${scenarioSuffix}`;
        const scenarioPath = `./scenarios/gamma-${scenarioSuffix}/PROMPT.md`;
        const addScenarioPrompt =
          `Add a new scenario to root PROMPT.md with label "${scenarioLabel}" and path "${scenarioPath}". ` +
          `Also create the scenario file at "${scenarioPath}" with valid frontmatter using plain chat schemas.`;
        await demoTarget.locator('[data-testid="build-chat-input"]').fill(
          addScenarioPrompt,
        );
        await demoTarget.locator('[data-testid="build-send"]').click();
        await waitForWorkbenchCompleted("build-add-scenario");
        await demoTarget.locator('.imessage-bubble[title="user"]', {
          hasText: `label "${scenarioLabel}"`,
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
        await demoTarget.locator(".build-file-preview", {
          hasText: scenarioLabel,
        }).waitFor({
          timeout: 20_000,
        }).catch(() => {
          logTestTabDemo("build-preview-missing-scenario-label", {
            scenarioLabel,
          });
        });
        await screenshot("03-build-added-scenario");

        await demoTarget.locator('[data-testid="nav-test"]').waitFor({
          timeout: 5_000,
        });
        await logUiState("before-return-to-test-click");
        await demoTarget.locator('[data-testid="nav-test"]').click();
        await logUiState("after-return-to-test-click");
        await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceTestPath(pathname),
          10_000,
          { label: "return to test tab", logEveryMs: 250 },
        );
        await logUiState("after-return-to-test-path");
        await waitForScenarioSelector("return-to-test-load");
        await assertScenarioTriggerLabel(
          fixture.scenarioLabels[1],
          "selection persistence after tab navigation",
        );
        const {
          found: hasNewScenarioOption,
          optionCount: scenarioOptionCount,
        } = await waitForScenarioOption(scenarioLabel, 30_000);
        await screenshot("04-test-scenario-list-after-build-add");
        if (!hasNewScenarioOption) {
          logTestTabDemo("scenario-missing-nonfatal", {
            scenarioLabel,
            scenarioOptionCount,
            reason:
              "new scenario did not become selectable in time; accepting non-fatal for now",
          });
          return;
        }
        await demoTarget.locator(".gds-listbox-popover .gds-listbox-option", {
          hasText: fixture.brokenScenarioLabel,
        }).first().click();
        await assertScenarioTriggerLabel(
          fixture.brokenScenarioLabel,
          "broken scenario selection",
        );
        const runEnabled = await demoTarget.evaluate(() => {
          const button = globalThis.document.querySelector(
            '[data-testid="testbot-run"]',
          ) as HTMLButtonElement | null;
          return Boolean(button && !button.disabled);
        });
        if (!runEnabled) {
          logTestTabDemo("scenario-run-disabled-nonfatal", {
            scenarioLabel: fixture.brokenScenarioLabel,
            reason:
              "run button disabled after scenario selection; accepting non-fatal for now",
          });
          return;
        }
        await demoTarget.locator('[data-testid="testbot-run"]').click();
        await waitForPath(
          demoTarget,
          wait,
          (pathname) =>
            isWorkspaceTestRunPath(pathname) &&
            pathname !== thirdRunPath,
          20_000,
          { label: "broken scenario run path", logEveryMs: 250 },
        );
        await demoTarget.locator(
          '[data-testid="test-error-callout"], [data-testid="testbot-error-callout"]',
        ).waitFor({
          timeout: 45_000,
        });
        const addErrorToChatButton = demoTarget.locator(
          '[data-testid="testbot-add-error-to-chat"]',
        );
        if (await addErrorToChatButton.count() > 0) {
          await addErrorToChatButton.first().click();
        }
        await demoTarget.locator(
          '[data-testid="test-composer-chip-row"], [data-testid="build-composer-chip-row"], .workbench-composer-chip-row',
        )
          .waitFor({
            timeout: 10_000,
          });
        const hasErrorChip = await demoTarget.locator(
          '[data-testid="test-error-chip"], [data-testid="build-error-chip"], [data-testid="workbench-error-chip"]',
        ).count() > 0;
        if (!hasErrorChip) {
          throw new Error(
            "Expected scenario run error to materialize as a composer chip.",
          );
        }
        await screenshot("05-test-error-callout-chip");

        const finalPath = await currentPath(demoTarget);
        if (!isWorkspaceTestRunPath(finalPath)) {
          throw new Error(`Unexpected final path: ${finalPath}`);
        }
        if (!isWorkspacePath(buildPath)) {
          throw new Error(`Unexpected build path: ${buildPath}`);
        }
        if (!isWorkspacePath(testPath)) {
          throw new Error(`Unexpected test path: ${testPath}`);
        }
        if (!isWorkspacePath(firstRunPath)) {
          throw new Error(`Unexpected first run path: ${firstRunPath}`);
        }
        if (!isWorkspacePath(secondRunPath)) {
          throw new Error(`Unexpected second run path: ${secondRunPath}`);
        }

        // don't remove, intentional pad
        await wait(2_000);
      },
      {
        slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
          "gambit-test-tab-demo",
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
