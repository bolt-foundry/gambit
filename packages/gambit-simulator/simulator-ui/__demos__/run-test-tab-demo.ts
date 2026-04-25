#!/usr/bin/env -S deno run -A
// Canonical command: `bft browser demo gambit-test-tab`

import * as path from "@std/path";
import { DatabaseSync } from "node:sqlite";
import {
  DemoServerError,
  runE2e,
  waitForPath,
} from "@bolt-foundry/browser-runtime";

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

async function ensureWorkbenchDrawerVisible(
  demoTarget: {
    locator: (selector: string) => {
      count(): Promise<number>;
      first(): { isVisible(): Promise<boolean> };
      click(): Promise<void>;
      waitFor(args?: { timeout?: number }): Promise<void>;
    };
  },
): Promise<void> {
  const drawer = demoTarget.locator(".workbench-drawer-docked");
  if (await drawer.count() > 0 && await drawer.first().isVisible()) {
    return;
  }
  await demoTarget.locator('[data-testid="nav-workbench"]').click();
  await drawer.waitFor({ timeout: 10_000 });
}

async function waitForAssistantWorkbenchReply(
  demoTarget: {
    locator: (selector: string, options?: { hasText?: string }) => {
      count(): Promise<number>;
      first(): {
        waitFor(args?: { timeout?: number }): Promise<void>;
        textContent(): Promise<string | null>;
      };
    };
  },
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  const assistantBubbles = demoTarget.locator(
    ".workbench-drawer-docked .imessage-row.left .imessage-bubble.left",
  );
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const count = await assistantBubbles.count();
    if (count > 0) {
      const text = await assistantBubbles.first().textContent().catch(() => "");
      if (typeof text === "string" && text.trim().length > 0) {
        return;
      }
    }
    await wait(500);
  }
  throw new Error("Timed out waiting for a Workbench assistant response.");
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
    const payloads = await demoTarget.evaluate(
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
          .filter((node) =>
            node?.__typename === "OutputMessage" &&
            (node.content ?? "").replace(/\s+/g, " ").trim() ===
              (messageText ?? "").replace(/\s+/g, " ").trim()
          ) ?? [];
      },
      args,
    ) as Array<{
      content?: string;
      messageRefId?: string;
      feedback?: { score?: number; reason?: string };
    }>;
    const matchingPayload = payloads.find((payload) =>
      payload?.feedback?.score === args.score &&
      payload.feedback?.reason === args.reason
    );
    if (matchingPayload) {
      return matchingPayload;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for feedback in GraphQL.");
}

async function readScenarioRunGraphqlMessages(
  demoTarget: {
    evaluate: <T, R>(
      pageFunction: (arg: T) => R | Promise<R>,
      arg: T,
    ) => Promise<R>;
  },
  args: {
    workspaceId: string;
    runId: string;
  },
): Promise<Array<{ role: string; content: string }>> {
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
      if (!response.ok) return [];
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
      return body.data?.workspace?.scenarioRuns?.edges
        ?.find((edge) => edge?.node?.id === runId)
        ?.node?.openResponses?.edges?.[0]?.node?.outputItems?.edges
        ?.map((edge) => edge?.node)
        .filter((node) => node?.__typename === "OutputMessage")
        .map((node) => ({
          role: node?.role ?? "",
          content: node?.content ?? "",
        })) ?? [];
    },
    args,
  ) as Array<{ role: string; content: string }>;

  return graphqlResponse;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function parseWorkspaceRunPath(pathname: string): {
  workspaceId: string;
  runId: string;
} | null {
  const normalized = pathname;
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
  const cliPath = path.join(
    repoRoot,
    "packages",
    "gambit",
    "src",
    "cli.ts",
  );
  const demoDeckPath = path.join(
    repoRoot,
    "packages",
    "gambit",
    "scaffolds",
    "demo",
    "examples",
    "advanced",
    "agent_with_typescript",
    "PROMPT.md",
  );
  const scenarioLabel = "Typescript agent scenario";
  const userMessage = "what time is it?";

  await runWithTempServeRoot(async (serveRoot) => {
    await runE2e(
      "gambit test tab demo",
      async ({ demoTarget, screenshot, wait }) => {
        await demoTarget.evaluate(() => {
          globalThis.localStorage?.setItem("gambit:build-chat-debug", "true");
        });
        await installLegacyFeedbackRouteMonitor(demoTarget);
        const normalizeWorkspacePath = (pathname: string): string => pathname;
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
              pathname === "/workspaces" ||
              pathname === "/workspaces/new" ||
              isWorkspaceBuildPath(pathname),
            5_000,
            { label: "simulator load", logEveryMs: 250 },
          );
        };

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
        if (selectedScenarioLabel !== scenarioLabel) {
          throw new Error(
            `Expected selected scenario "${scenarioLabel}", got "${selectedScenarioLabel}".`,
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
        await composerInput.fill(userMessage);
        await composerSend.waitFor({ timeout: 10_000 });
        const enabledComposerSend = demoTarget.locator(
          '[data-testid="testbot-chat-send"]:not([disabled])',
        ).first();
        await enabledComposerSend.waitFor({ timeout: 10_000 });
        await enabledComposerSend.click();

        await demoTarget.locator(".imessage-row.right .imessage-bubble.right", {
          hasText: userMessage,
        }).first().waitFor({
          timeout: 10_000,
        });
        await waitForCondition(async () => {
          const graphqlMessages = await readScenarioRunGraphqlMessages(
            demoTarget,
            ids,
          );
          const lastUserIndex = graphqlMessages.findLastIndex((message) =>
            message.role === "user" &&
            normalizeText(message.content) === userMessage
          );
          if (lastUserIndex < 0) return false;
          const assistantReply = graphqlMessages.slice(lastUserIndex + 1).find(
            (message) => message.role === "assistant",
          );
          return graphqlMessages.some((message) =>
            message.role === "user" &&
            normalizeText(message.content) === userMessage
          ) && Boolean(assistantReply);
        }, 20_000);
        const graphqlMessagesAfterSend = await readScenarioRunGraphqlMessages(
          demoTarget,
          ids,
        );
        const lastUserIndex = graphqlMessagesAfterSend.findLastIndex((
          message,
        ) =>
          message.role === "user" &&
          normalizeText(message.content) === userMessage
        );
        const assistantReplyText = normalizeText(
          graphqlMessagesAfterSend.slice(lastUserIndex + 1)
            .find((message) => message.role === "assistant")
            ?.content,
        );
        if (!assistantReplyText) {
          throw new Error("Expected a non-empty assistant reply after send.");
        }
        await demoTarget.locator(".imessage-row.left .imessage-bubble.left", {
          hasText: assistantReplyText,
        }).first().waitFor({
          timeout: 10_000,
        });
        const followupAssistantBubble = demoTarget.locator(
          ".imessage-row.left .imessage-bubble.left",
          { hasText: assistantReplyText },
        ).first();

        const sqlitePath = path.join(
          serveRoot,
          ".gambit",
          "workspaces",
          ids.workspaceId,
          "workspace.sqlite",
        );
        const db = new DatabaseSync(sqlitePath);
        let runEventCount = 0;
        let stateMessageCount = 0;
        let sqliteMessages: Array<
          { role: string | null; content: string | null }
        > = [];
        try {
          const stateRow = db.prepare(`
            SELECT state_json
            FROM workspace_state_v0
            WHERE workspace_id = ?
          `).get(ids.workspaceId) as { state_json?: string } | undefined;
          if (typeof stateRow?.state_json !== "string") {
            throw new Error("Expected workspace state row in sqlite.");
          }
          const state = JSON.parse(stateRow.state_json) as {
            meta?: { scenarioRunId?: string };
            messages?: Array<unknown>;
          };
          if (state.meta?.scenarioRunId !== ids.runId) {
            throw new Error(
              `Expected state scenarioRunId ${ids.runId}, got ${state.meta?.scenarioRunId}.`,
            );
          }
          stateMessageCount = state.messages?.length ?? 0;
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

        const graphqlMessages = await readScenarioRunGraphqlMessages(
          demoTarget,
          ids,
        );
        logTestTabDemo("graphql-evidence", {
          workspaceId: ids.workspaceId,
          runId: ids.runId,
          graphqlMessages,
        });
        if (
          !graphqlMessages.some((message) =>
            normalizeText(message.content) === assistantReplyText
          )
        ) {
          throw new Error(
            "Expected GraphQL transcript to include assistant output from the live run.",
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
          hasText: userMessage,
        }).first().waitFor({
          timeout: 10_000,
        });
        await demoTarget.locator(".imessage-row.left .imessage-bubble.left", {
          hasText: assistantReplyText,
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

        const graphqlFeedback = await waitForGraphqlFeedback(
          demoTarget,
          {
            workspaceId: ids.workspaceId,
            runId: ids.runId,
            messageText: assistantReplyText,
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
          hasText: userMessage,
        }).first().waitFor({ timeout: 10_000 });
        await demoTarget.locator(".imessage-row.left .imessage-bubble.left", {
          hasText: assistantReplyText,
        }).first().waitFor({ timeout: 10_000 });
        await waitForFeedbackReason(
          demoTarget,
          {
            messageText: assistantReplyText,
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
          !reloadedMessages.some((message) => message.includes(userMessage)) ||
          !reloadedMessages.some((message) =>
            message.includes(assistantReplyText)
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

        await followupAssistantBubble.locator(
          '[data-testid="feedback-add-to-chat"]',
        ).click();
        await ensureWorkbenchDrawerVisible(demoTarget);
        await demoTarget.locator('[data-testid="build-composer-chip-row"]')
          .waitFor({
            timeout: 10_000,
          });
        await screenshot("07-test-feedback-chip-added-to-workbench");

        await demoTarget.locator('[data-testid="build-chat-input"]').fill(
          "do you see what feedback they left",
        );
        await demoTarget.locator('[data-testid="build-send"]:not([disabled])')
          .waitFor({
            timeout: 15_000,
          });
        await demoTarget.locator('[data-testid="build-send"]:not([disabled])')
          .click();
        await waitForAssistantWorkbenchReply(demoTarget, wait);
        await screenshot("08-test-feedback-chip-sent-response");
        await wait(2_000);

        logTestTabDemo("demo-complete", {
          workspaceId: ids.workspaceId,
          runId: ids.runId,
          stateMessageCount,
          sqliteRunEventCount: runEventCount,
          graphqlMessageCount: graphqlMessages.length,
          feedbackScore,
          feedbackReason,
        });
      },
      {
        slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
          "gambit-test-tab-demo",
        iframeTargetPath: "/",
        server: {
          cwd: serveRoot,
          command: (targetPort: number) => [
            "deno",
            "run",
            "-A",
            cliPath,
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
