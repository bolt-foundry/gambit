#!/usr/bin/env -S deno run -A
// Shortcut: `bft gambit-demo:test-tab`

import * as path from "@std/path";
import { DatabaseSync } from "node:sqlite";
import { runE2e, waitForPath } from "../../../demo-runner/src/e2e/utils.ts";
import { DemoServerError } from "../../../demo-runner/src/runner.ts";
import { createTestTabOpenResponsesDemoFixture } from "./fixtures/test-tab-openresponses-fixture.ts";

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

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition.");
}

async function waitForFeedbackReason(
  demoTarget: {
    evaluate: <T, R>(
      pageFunction: (arg: T) => R | Promise<R>,
      arg: T,
    ) => Promise<R>;
  },
  args: {
    messageText: string;
    expectedReason: string;
  },
  timeoutMs: number,
): Promise<void> {
  await waitForCondition(async () => {
    return await demoTarget.evaluate(
      ({ messageText, expectedReason }) => {
        const bubbles = Array.from(
          globalThis.document.querySelectorAll(".imessage-bubble.left"),
        );
        const bubble = bubbles.find((node) =>
          (node.textContent ?? "").includes(messageText)
        );
        if (!(bubble instanceof HTMLElement)) return false;
        const reason = bubble.querySelector(
          '[data-testid="feedback-reason"]',
        );
        return reason instanceof HTMLTextAreaElement &&
          reason.value === expectedReason;
      },
      args,
    );
  }, timeoutMs);
}

async function installLegacyFeedbackRouteMonitor(
  demoTarget: {
    addInitScript?: (script: () => void) => Promise<void>;
    evaluate: <T, R>(
      pageFunction: (arg: T) => R | Promise<R>,
      arg: T,
    ) => Promise<R>;
  },
): Promise<void> {
  const install = () => {
    const globalWithMonitor = globalThis as typeof globalThis & {
      __gambitLegacyFeedbackRouteCalls?: Array<string>;
      __gambitLegacyFeedbackRouteMonitorInstalled?: boolean;
    };
    if (globalWithMonitor.__gambitLegacyFeedbackRouteMonitorInstalled) return;
    globalWithMonitor.__gambitLegacyFeedbackRouteMonitorInstalled = true;
    globalWithMonitor.__gambitLegacyFeedbackRouteCalls = [];
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (...args) => {
      const request = args[0];
      const url = typeof request === "string"
        ? request
        : request instanceof Request
        ? request.url
        : String(request);
      if (
        url.includes("/api/workspace/feedback") ||
        /\/api\/workspaces\/[^/]+\/test\/[^/]+$/.test(url)
      ) {
        globalWithMonitor.__gambitLegacyFeedbackRouteCalls?.push(url);
      }
      return await originalFetch(...args);
    };
  };

  await demoTarget.addInitScript?.(install);
  await demoTarget.evaluate(() => {
    const globalWithMonitor = globalThis as typeof globalThis & {
      __gambitLegacyFeedbackRouteCalls?: Array<string>;
      __gambitLegacyFeedbackRouteMonitorInstalled?: boolean;
    };
    if (globalWithMonitor.__gambitLegacyFeedbackRouteMonitorInstalled) return;
    globalWithMonitor.__gambitLegacyFeedbackRouteMonitorInstalled = true;
    globalWithMonitor.__gambitLegacyFeedbackRouteCalls = [];
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (...args) => {
      const request = args[0];
      const url = typeof request === "string"
        ? request
        : request instanceof Request
        ? request.url
        : String(request);
      if (
        url.includes("/api/workspace/feedback") ||
        /\/api\/workspaces\/[^/]+\/test\/[^/]+$/.test(url)
      ) {
        globalWithMonitor.__gambitLegacyFeedbackRouteCalls?.push(url);
      }
      return await originalFetch(...args);
    };
  }, undefined);
}

async function waitForGraphqlFeedback(
  demoTarget: {
    evaluate: <T, R>(
      pageFunction: (arg: T) => R | Promise<R>,
      arg: T,
    ) => Promise<R>;
  },
  args: {
    workspaceId: string;
    runId: string;
    messageText: string;
    score: number;
    reason: string;
  },
  timeoutMs: number,
): Promise<{
  content?: string;
  messageRefId?: string;
  feedback?: { score?: number; reason?: string };
}> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await demoTarget.evaluate(
      async ({
        workspaceId,
        runId,
        messageText,
      }) => {
        const response = await fetch("/graphql", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: `
              query ScenarioRunFeedback($workspaceId: ID!) {
                workspace(id: $workspaceId) {
                  scenarioRuns(first: 10) {
                    edges {
                      node {
                        id
                        openResponses(first: 1) {
                          edges {
                            node {
                              outputItems(first: 50) {
                                edges {
                                  node {
                                    __typename
                                    ... on OutputMessage {
                                      messageRefId
                                      content
                                      feedback {
                                        score
                                        reason
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            `,
            variables: { workspaceId },
          }),
        });
        if (!response.ok) return null;
        const body = await response.json() as {
          data?: {
            workspace?: {
              scenarioRuns?: {
                edges?: Array<{
                  node?: {
                    id?: string;
                    openResponses?: {
                      edges?: Array<{
                        node?: {
                          outputItems?: {
                            edges?: Array<{
                              node?: {
                                __typename?: string;
                                content?: string;
                                messageRefId?: string;
                                feedback?: { score?: number; reason?: string };
                              };
                            }>;
                          };
                        };
                      }>;
                    };
                  };
                }>;
              };
            };
          };
        };
        return body.data?.workspace?.scenarioRuns?.edges
          ?.find((edge) => edge?.node?.id === runId)
          ?.node?.openResponses?.edges?.[0]?.node?.outputItems?.edges
          ?.map((edge) => edge?.node)
          .find((node) =>
            node?.__typename === "OutputMessage" &&
            node.content === messageText
          ) ?? null;
      },
      args,
    ) as {
      content?: string;
      messageRefId?: string;
      feedback?: { score?: number; reason?: string };
    } | null;
    if (
      payload?.feedback?.score === args.score &&
      payload.feedback?.reason === args.reason
    ) {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for feedback in GraphQL.");
}

function parseWorkspaceRunPath(pathname: string): {
  workspaceId: string;
  runId: string;
} | null {
  const normalized = pathname.startsWith("/isograph/")
    ? pathname.slice("/isograph".length)
    : pathname;
  const match = normalized.match(/^\/workspaces\/([^/]+)\/test\/([^/]+)$/);
  if (!match) return null;
  return {
    workspaceId: decodeURIComponent(match[1] ?? ""),
    runId: decodeURIComponent(match[2] ?? ""),
  };
}

async function main(): Promise<void> {
  const moduleDir = path.dirname(path.fromFileUrl(import.meta.url));
  const repoRoot = path.resolve(moduleDir, "..", "..", "..", "..");
  const demoServerPath = path.join(
    repoRoot,
    "packages",
    "gambit",
    "simulator-ui",
    "__demos__",
    "serve-test-tab-demo.ts",
  );

  await runWithTempServeRoot(async (serveRoot) => {
    const fixture = await createTestTabOpenResponsesDemoFixture(serveRoot);
    await runE2e(
      "gambit test tab demo",
      async ({ demoTarget, screenshot, wait }) => {
        await installLegacyFeedbackRouteMonitor(demoTarget);
        const normalizeWorkspacePath = (pathname: string): string =>
          pathname.startsWith("/isograph/")
            ? pathname.slice("/isograph".length)
            : pathname;
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

        const waitForWorkspaceBuildPath = async (): Promise<string> => {
          return await waitForPath(
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
        };

        const assistantBubble = demoTarget.locator(
          ".imessage-row.left .imessage-bubble.left",
        ).first();
        const followupAssistantBubble = demoTarget.locator(
          ".imessage-row.left .imessage-bubble.left",
          { hasText: "Fine. What do you need?" },
        ).first();
        const composerInput = demoTarget.locator(
          ".composer textarea.message-input",
        ).first();
        const composerSend = demoTarget.locator(
          '[data-testid="testbot-chat-send"]',
        ).first();

        await waitForWorkspaceBuildPath();
        const createWorkspaceCta = demoTarget.locator(
          '[data-testid="workspace-create-cta"]',
        );
        if (await createWorkspaceCta.count() > 0) {
          await createWorkspaceCta.first().waitFor({ timeout: 10_000 });
          await createWorkspaceCta.first().click();
        }

        await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceBuildPath(pathname),
          10_000,
          { label: "workspace build load", logEveryMs: 250 },
        );

        await demoTarget.locator('[data-testid="nav-test"]').waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator('[data-testid="nav-test"]').click();
        await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceTestPath(pathname),
          10_000,
          { label: "test tab load", logEveryMs: 250 },
        );

        await demoTarget.locator('[data-testid="test-tab-scaffold"]').waitFor({
          timeout: 10_000,
        });
        await screenshot("01-test-tab-loaded");

        const selectedScenarioLabel = await demoTarget.evaluate(() => {
          const legacy = globalThis.document.querySelector(
            '[data-testid="test-scenario-selector"] .gds-listbox-label',
          );
          if (legacy) {
            return (legacy.textContent ?? "").replace(/\s+/g, " ").trim();
          }
          const labels = globalThis.document.querySelectorAll(
            '[data-testid="test-tab-scaffold"] .test-bot-sidebar .gds-listbox-label',
          );
          const label = labels.length > 1 ? labels[1] : labels[0];
          return (label?.textContent ?? "").replace(/\s+/g, " ").trim();
        });
        if (selectedScenarioLabel !== fixture.scenarioLabel) {
          throw new Error(
            `Expected selected scenario "${fixture.scenarioLabel}", got "${selectedScenarioLabel}".`,
          );
        }

        const initialStartAssistant = demoTarget.locator(
          '[data-testid="testbot-start-assistant"]',
        ).first();
        if (
          await initialStartAssistant.count() > 0 &&
          await initialStartAssistant.isVisible().catch(() => false)
        ) {
          await initialStartAssistant.click();
        } else {
          await demoTarget.locator('[data-testid="testbot-run"]').waitFor({
            timeout: 10_000,
          });
          await demoTarget.locator(
            '[data-testid="testbot-run"]:not([disabled])',
          )
            .first().click();
        }
        const runPath = await waitForPath(
          demoTarget,
          wait,
          (pathname) => isWorkspaceTestRunPath(pathname),
          20_000,
          { label: "scenario run path", logEveryMs: 250 },
        );
        const ids = parseWorkspaceRunPath(runPath);
        if (!ids) {
          throw new Error(`Unable to parse workspace/run ids from ${runPath}`);
        }
        await screenshot("02-test-run-route");

        await composerInput.waitFor({ timeout: 10_000 });
        await composerInput.fill("how are you");
        await composerSend.waitFor({ timeout: 10_000 });
        await composerSend.click();

        const sqlitePath = path.join(
          serveRoot,
          ".gambit",
          "workspaces",
          ids.workspaceId,
          "workspace.sqlite",
        );
        const statePath = path.join(
          serveRoot,
          ".gambit",
          "workspaces",
          ids.workspaceId,
          "state.json",
        );

        await waitForCondition(async () => {
          try {
            const db = new DatabaseSync(sqlitePath);
            try {
              const rows = db.prepare(`
                SELECT role, content
                FROM openresponses_output_items_v0
                WHERE workspace_id = ? AND run_id = ?
                ORDER BY sequence ASC, output_index ASC, item_key ASC
              `).all(ids.workspaceId, ids.runId) as Array<{
                role: string | null;
                content: string | null;
              }>;
              return rows.some((row) =>
                row.role === "user" && row.content === "how are you"
              ) &&
                rows.some((row) =>
                  row.role === "assistant" &&
                  row.content === "Fine. What do you need?"
                );
            } finally {
              db.close();
            }
          } catch {
            return false;
          }
        }, 10_000);

        const state = JSON.parse(await Deno.readTextFile(statePath)) as {
          meta?: { scenarioRunId?: string };
          messages?: Array<{ role?: string; content?: unknown }>;
        };
        if (state.meta?.scenarioRunId !== ids.runId) {
          throw new Error(
            `Expected state scenarioRunId ${ids.runId}, got ${state.meta?.scenarioRunId}.`,
          );
        }

        const db = new DatabaseSync(sqlitePath);
        let runEventCount = 0;
        let sqliteMessages: Array<
          { role: string | null; content: string | null }
        > = [];
        try {
          const eventRow = db.prepare(`
            SELECT COUNT(*) AS count
            FROM openresponses_run_events_v0
            WHERE workspace_id = ? AND run_id = ?
          `).get(ids.workspaceId, ids.runId) as { count?: number };
          runEventCount = eventRow.count ?? 0;
          sqliteMessages = db.prepare(`
            SELECT role, content
            FROM openresponses_output_items_v0
            WHERE workspace_id = ? AND run_id = ?
            ORDER BY sequence ASC, output_index ASC, item_key ASC
          `).all(ids.workspaceId, ids.runId) as Array<{
            role: string | null;
            content: string | null;
          }>;
        } finally {
          db.close();
        }
        logTestTabDemo("sqlite-evidence", {
          workspaceId: ids.workspaceId,
          runId: ids.runId,
          runEventCount,
          sqliteMessages,
        });
        if (runEventCount <= 0) {
          throw new Error(
            "Expected OpenResponses run events for scenario run.",
          );
        }

        const graphqlResponse = await demoTarget.evaluate(
          async ({ workspaceId, runId }) => {
            const response = await fetch("/graphql", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                query: `
                  query ScenarioRuns($workspaceId: ID!) {
                    workspace(id: $workspaceId) {
                      scenarioRuns(first: 10) {
                        edges {
                          node {
                            id
                            openResponses(first: 1) {
                              edges {
                                node {
                                  outputItems(first: 50) {
                                    edges {
                                      node {
                                        __typename
                                        ... on OutputMessage {
                                          role
                                          content
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                `,
                variables: { workspaceId, runId },
              }),
            });
            return await response.json();
          },
          ids,
        ) as {
          data?: {
            workspace?: {
              scenarioRuns?: {
                edges?: Array<{
                  node?: {
                    id?: string;
                    openResponses?: {
                      edges?: Array<{
                        node?: {
                          outputItems?: {
                            edges?: Array<{
                              node?: {
                                __typename?: string;
                                role?: string;
                                content?: string;
                              };
                            }>;
                          };
                        };
                      }>;
                    };
                  };
                }>;
              };
            };
          };
        };

        const graphqlMessages =
          graphqlResponse.data?.workspace?.scenarioRuns?.edges
            ?.find((edge) => edge?.node?.id === ids.runId)
            ?.node?.openResponses?.edges?.[0]?.node?.outputItems?.edges
            ?.map((edge) => edge?.node)
            .filter((node) => node?.__typename === "OutputMessage")
            .map((node) => ({
              role: node?.role ?? "",
              content: node?.content ?? "",
            })) ?? [];
        logTestTabDemo("graphql-evidence", {
          workspaceId: ids.workspaceId,
          runId: ids.runId,
          graphqlMessages,
        });
        if (
          !graphqlMessages.some((message) =>
            message.content === "Fine. What do you need?"
          )
        ) {
          throw new Error(
            "Expected GraphQL transcript to include follow-up assistant output.",
          );
        }

        await demoTarget.evaluate(
          (path) => globalThis.location.assign(path),
          runPath,
        );
        await waitForPath(
          demoTarget,
          wait,
          (pathname) => pathname === runPath,
          10_000,
          { label: "test run transcript rehydrate", logEveryMs: 250 },
        );
        await demoTarget.locator('[data-testid="test-tab-scaffold"]').waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator(".imessage-row.right .imessage-bubble.right", {
          hasText: "how are you",
        }).first().waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator(".imessage-row.left .imessage-bubble.left", {
          hasText: "Fine. What do you need?",
        }).first().waitFor({
          timeout: 10_000,
        });
        await screenshot("03-test-transcript-visible");

        await screenshot("04-test-openresponses-projected");

        const feedbackScore = -2;
        const feedbackReason = "Persisted after refresh";
        await followupAssistantBubble.locator(
          `[data-testid="feedback-score-${feedbackScore}"]`,
        ).click();
        const feedbackReasonInput = followupAssistantBubble.locator(
          '[data-testid="feedback-reason"]',
        );
        await feedbackReasonInput.waitFor({ timeout: 10_000 });
        await feedbackReasonInput.fill(feedbackReason);
        await feedbackReasonInput.blur();

        await waitForCondition(async () => {
          try {
            const refreshedState = JSON.parse(
              await Deno.readTextFile(statePath),
            ) as {
              feedback?: Array<{
                runId?: string;
                messageRefId?: string;
                score?: number;
                reason?: string;
              }>;
            };
            return (refreshedState.feedback ?? []).some((entry) =>
              entry.runId === ids.runId &&
              entry.score === feedbackScore &&
              entry.reason === feedbackReason
            );
          } catch {
            return false;
          }
        }, 10_000);

        const graphqlFeedback = await waitForGraphqlFeedback(
          demoTarget,
          {
            workspaceId: ids.workspaceId,
            runId: ids.runId,
            messageText: "Fine. What do you need?",
            score: feedbackScore,
            reason: feedbackReason,
          },
          10_000,
        );
        const legacyFeedbackRouteCallsAfterSave = await demoTarget.evaluate(
          () =>
            ((globalThis as typeof globalThis & {
              __gambitLegacyFeedbackRouteCalls?: Array<string>;
            }).__gambitLegacyFeedbackRouteCalls ?? []).slice(),
          undefined,
        );
        logTestTabDemo("feedback-evidence", {
          workspaceId: ids.workspaceId,
          runId: ids.runId,
          feedbackScore,
          feedbackReason,
          graphqlFeedback,
          legacyFeedbackRouteCallsAfterSave,
        });
        if (legacyFeedbackRouteCallsAfterSave.length > 0) {
          throw new Error(
            `Expected no legacy feedback-route calls during save, got ${
              JSON.stringify(legacyFeedbackRouteCallsAfterSave)
            }.`,
          );
        }
        await screenshot("05-test-feedback-before-refresh");

        await demoTarget.evaluate(
          (path) => globalThis.location.assign(path),
          runPath,
        );
        await waitForPath(
          demoTarget,
          wait,
          (pathname) => pathname === runPath,
          10_000,
          { label: "test run reload", logEveryMs: 250 },
        );
        await demoTarget.locator('[data-testid="test-tab-scaffold"]').waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator(".imessage-row.right .imessage-bubble.right", {
          hasText: "how are you",
        }).first().waitFor({ timeout: 10_000 });
        await demoTarget.locator(".imessage-row.left .imessage-bubble.left", {
          hasText: "Fine. What do you need?",
        }).first().waitFor({ timeout: 10_000 });
        await waitForFeedbackReason(
          demoTarget,
          {
            messageText: "Fine. What do you need?",
            expectedReason: feedbackReason,
          },
          10_000,
        );
        const legacyFeedbackRouteCallsAfterRefresh = await demoTarget.evaluate(
          () =>
            ((globalThis as typeof globalThis & {
              __gambitLegacyFeedbackRouteCalls?: Array<string>;
            }).__gambitLegacyFeedbackRouteCalls ?? []).slice(),
          undefined,
        );
        const reloadedMessages = await demoTarget.evaluate(() => {
          return Array.from(
            globalThis.document.querySelectorAll(".imessage-bubble"),
          ).map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter((value) => value.length > 0);
        });
        if (
          !reloadedMessages.some((message) =>
            message.includes("how are you")
          ) ||
          !reloadedMessages.some((message) =>
            message.includes("Fine. What do you need?")
          )
        ) {
          throw new Error(
            `Expected transcript to survive refresh, got ${
              JSON.stringify(reloadedMessages)
            }.`,
          );
        }
        if (legacyFeedbackRouteCallsAfterRefresh.length > 0) {
          throw new Error(
            `Expected no legacy feedback-route calls across refresh, got ${
              JSON.stringify(legacyFeedbackRouteCallsAfterRefresh)
            }.`,
          );
        }
        await screenshot("06-test-feedback-after-refresh");

        logTestTabDemo("demo-complete", {
          workspaceId: ids.workspaceId,
          runId: ids.runId,
          stateMessageCount: state.messages?.length ?? 0,
          sqliteRunEventCount: runEventCount,
          graphqlMessageCount: graphqlMessages.length,
          feedbackScore,
          feedbackReason,
        });
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
            demoServerPath,
            fixture.rootDeckPath,
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
