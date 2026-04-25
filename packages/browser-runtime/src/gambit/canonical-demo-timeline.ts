// deno-lint-ignore-file no-unreachable
import { runTimelineSteps } from "@bolt-foundry/browser-runtime/src/automation/timeline.ts";
import type { DemoScenarioContext } from "@bolt-foundry/browser-runtime/src/runnerTypes.ts";

const DEFAULT_PROMPT =
  "Build a simple support assistant with one test and one grader.";
const BUILD_CHAT_INPUT_RECOVERY_TIMEOUT_MS = 300_000;

type WorkspaceRouteSnapshot = {
  workspaceId: string | null;
  tab: "build" | "test" | "grade" | "verify" | null;
  pathname: string;
};

function isActionLoggingEnabled(): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_ACTION_LOG") || "").trim()
    .toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function timelineLog(message: string): void {
  if (!isActionLoggingEnabled()) return;
  Deno.stdout.writeSync(
    new TextEncoder().encode(
      `[canonical-demo] ${new Date().toISOString()} ${message}\n`,
    ),
  );
}

async function waitForCondition(
  predicate: () => Promise<boolean>,
  opts?: {
    timeoutMs?: number;
    pollMs?: number;
    label?: string;
    logEveryMs?: number;
  },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const pollMs = opts?.pollMs ?? 200;
  const label = opts?.label ?? "condition";
  const logEveryMs = opts?.logEveryMs ?? 5_000;
  const startedAt = Date.now();
  let lastHeartbeatAt = startedAt;
  timelineLog(`wait start: ${label} (timeout ${timeoutMs}ms)`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    if (Date.now() - lastHeartbeatAt >= logEveryMs) {
      timelineLog(`wait pending: ${label} (+${Date.now() - startedAt}ms)`);
      lastHeartbeatAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  timelineLog(`wait timeout: ${label} (+${Date.now() - startedAt}ms)`);
  throw new Error(`[canonical-demo] timed out waiting for ${label}`);
}

async function waitForConditionSoft(
  predicate: () => Promise<boolean>,
  opts?: {
    timeoutMs?: number;
    pollMs?: number;
    label?: string;
    logEveryMs?: number;
  },
): Promise<boolean> {
  try {
    await waitForCondition(predicate, opts);
    return true;
  } catch (error) {
    timelineLog(
      `soft wait failed for "${opts?.label ?? "condition"}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

async function waitForTextAbsentStable(
  demoTarget: DemoScenarioContext["demoTarget"],
  text: string | RegExp,
  opts?: {
    timeoutMs?: number;
    stableMs?: number;
    pollMs?: number;
    label?: string;
  },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const stableMs = opts?.stableMs ?? 1_200;
  const pollMs = opts?.pollMs ?? 200;
  const deadline = Date.now() + timeoutMs;
  let absentSince = 0;
  while (Date.now() < deadline) {
    const locator = typeof text === "string"
      ? demoTarget.getByText(text, { exact: false })
      : demoTarget.getByText(text);
    const count = await locator.count();
    let anyVisible = false;
    for (let i = 0; i < count; i += 1) {
      if (await locator.nth(i).isVisible()) {
        anyVisible = true;
        break;
      }
    }
    if (!anyVisible) {
      if (absentSince === 0) absentSince = Date.now();
      if (Date.now() - absentSince >= stableMs) return;
    } else {
      absentSince = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(
    `[canonical-demo] timed out waiting for ${
      opts?.label ?? `stable absence of ${String(text)}`
    }`,
  );
}

async function waitForTestTranscriptRows(
  demoTarget: DemoScenarioContext["demoTarget"],
  opts?: { timeoutMs?: number },
): Promise<void> {
  await waitForCondition(async () => {
    const empty = demoTarget.getByText("No messages yet.", { exact: false });
    if ((await empty.count()) > 0 && await empty.first().isVisible()) {
      return false;
    }
    const rows = demoTarget.locator(
      ".test-bot-thread .imessage-row .imessage-bubble",
    );
    const count = await rows.count();
    for (let i = 0; i < count; i += 1) {
      const bubble = rows.nth(i);
      if (!(await bubble.isVisible())) continue;
      const text = (await bubble.innerText()).trim();
      if (text.length > 0) return true;
    }
    return false;
  }, {
    timeoutMs: opts?.timeoutMs ?? 45_000,
    label: "test transcript rows (non-empty)",
  });
}

async function readTestStatusText(
  demoTarget: DemoScenarioContext["demoTarget"],
): Promise<string> {
  return (await demoTarget.locator('[data-testid="testbot-status"]')
    .innerText())
    .trim();
}

function normalizeTestStatus(value: string): string {
  return value.trim().toLowerCase();
}

function isTestTerminalStatus(status: string): boolean {
  return status.includes("completed") || status.includes("failed") ||
    status.includes("error") || status.includes("canceled");
}

async function readLatestAssistantMessage(
  demoTarget: DemoScenarioContext["demoTarget"],
): Promise<string> {
  const bubbles = demoTarget.locator(".imessage-row.left .imessage-bubble");
  const count = await bubbles.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    const text = (await bubbles.nth(i).innerText()).trim();
    if (text) return text;
  }
  return "";
}

async function waitForLatestAssistantMessage(
  demoTarget: DemoScenarioContext["demoTarget"],
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 8_000;
  const pollMs = opts?.pollMs ?? 200;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = await readLatestAssistantMessage(demoTarget);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return "";
}

async function waitForConcreteWorkspaceId(
  demoTarget: DemoScenarioContext["demoTarget"],
  opts?: { timeoutMs?: number },
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const route = getWorkspaceRouteSnapshot(demoTarget);
    if (route.tab === "build" && route.workspaceId) {
      return route.workspaceId;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const finalRoute = getWorkspaceRouteSnapshot(demoTarget);
  throw new Error(
    `[canonical-demo] build setup: timed out waiting for concrete workspace id at /build; current path ${finalRoute.pathname}`,
  );
}

function getWorkspaceRouteSnapshot(
  demoTarget: DemoScenarioContext["demoTarget"],
): WorkspaceRouteSnapshot {
  const url = new URL(demoTarget.url());
  const match = url.pathname.match(
    /^\/workspaces\/([^/]+)\/(build|test|grade|verify)(?:\/[^/]+)?$/,
  );
  if (!match) {
    return { workspaceId: null, tab: null, pathname: url.pathname };
  }
  const rawId = decodeURIComponent(match[1]);
  return {
    workspaceId: rawId === "new" ? null : rawId,
    tab: match[2] as "build" | "test" | "grade" | "verify",
    pathname: url.pathname,
  };
}

function assertWorkspaceContinuity(
  demoTarget: DemoScenarioContext["demoTarget"],
  opts: {
    expectedTab: "build" | "test" | "grade";
    expectedWorkspaceId: string;
    step: string;
  },
): void {
  const route = getWorkspaceRouteSnapshot(demoTarget);
  if (route.tab !== opts.expectedTab) {
    throw new Error(
      `[canonical-demo] ${opts.step}: expected tab "${opts.expectedTab}" but got "${route.tab}" at ${route.pathname}`,
    );
  }
  if (!route.workspaceId) {
    throw new Error(
      `[canonical-demo] ${opts.step}: expected a concrete workspace id but URL is ${route.pathname}`,
    );
  }
  if (route.workspaceId !== opts.expectedWorkspaceId) {
    throw new Error(
      `[canonical-demo] ${opts.step}: workspace changed from "${opts.expectedWorkspaceId}" to "${route.workspaceId}" at ${route.pathname}`,
    );
  }
}

async function loadScenarioDecks(
  ctx: DemoScenarioContext,
  workspaceId: string | null,
): Promise<Array<{ id: string; label: string }>> {
  const url = new URL("/api/test", ctx.baseUrl);
  if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({})) as {
    testDecks?: Array<{ id?: string; label?: string }>;
  };
  return (data.testDecks ?? []).filter((deck) =>
    typeof deck?.id === "string" && typeof deck?.label === "string"
  ) as Array<{ id: string; label: string }>;
}

async function waitForScenarioDecks(
  ctx: DemoScenarioContext,
  workspaceId: string | null,
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<Array<{ id: string; label: string }>> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const pollMs = opts?.pollMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const scenarios = await loadScenarioDecks(ctx, workspaceId);
    if (scenarios.length > 0) {
      return scenarios;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return [];
}

export async function runCanonicalDemoTimeline(
  ctx: DemoScenarioContext,
  opts?: {
    prompt?: string;
    nextPrompt?: (assistantPrompt?: string) => Promise<string>;
    maxTurns?: number;
  },
): Promise<void> {
  const prompt = opts?.prompt ?? DEFAULT_PROMPT;
  const nextPrompt = opts?.nextPrompt;
  const maxTurns = opts?.maxTurns ?? 6;
  await ctx.demoTarget.evaluate(() => {
    try {
      globalThis.localStorage.setItem("gambit.gradeDebug", "1");
    } catch {
      // ignore storage errors in constrained browser contexts
    }
  });

  // Walkthrough step 2: enter Build tab and confirm the chat surface is ready.
  await runTimelineSteps(ctx, [
    { type: "wait-for", selector: '[data-testid="nav-build"]' },
    { type: "click", selector: '[data-testid="nav-build"]' },
    { type: "wait-for", selector: '[data-testid="build-chat-input"]' },
    { type: "wait", ms: 400 },
    { type: "screenshot", label: "01-build-tab" },
  ]);
  const canonicalWorkspaceId = await waitForConcreteWorkspaceId(
    ctx.demoTarget,
  );
  assertWorkspaceContinuity(ctx.demoTarget, {
    expectedTab: "build",
    expectedWorkspaceId: canonicalWorkspaceId,
    step: "after-build-open",
  });

  // Walkthrough steps 3-4: provide intent prompt(s), wait for build writes.
  if (nextPrompt) {
    let assistantPrompt: string | undefined = undefined;
    for (let turn = 0; turn < maxTurns; turn += 1) {
      const userPrompt = await nextPrompt(assistantPrompt);
      if (!userPrompt) break;
      await runTimelineSteps(ctx, [
        { type: "click", selector: '[data-testid="build-chat-input"]' },
        {
          type: "type",
          selector: '[data-testid="build-chat-input"]',
          text: userPrompt,
          clear: true,
          delayMs: 25,
        },
        { type: "wait", ms: 250 },
        { type: "click", selector: '[data-testid="build-send"]' },
        {
          type: "wait-for",
          selector: '[data-testid="build-chat-input"]:not([disabled])',
          timeoutMs: BUILD_CHAT_INPUT_RECOVERY_TIMEOUT_MS,
        },
      ]);
      assistantPrompt = await waitForLatestAssistantMessage(ctx.demoTarget);
      if (!assistantPrompt) {
        timelineLog(
          "no assistant response after build turn; ending prompt loop early",
        );
        break;
      }
    }
  } else {
    await runTimelineSteps(ctx, [
      { type: "click", selector: '[data-testid="build-chat-input"]' },
      {
        type: "type",
        selector: '[data-testid="build-chat-input"]',
        text: prompt,
        clear: true,
        delayMs: 25,
      },
      { type: "wait", ms: 250 },
      { type: "click", selector: '[data-testid="build-send"]' },
      {
        type: "wait-for",
        selector: '[data-testid="build-chat-input"]:not([disabled])',
        timeoutMs: BUILD_CHAT_INPUT_RECOVERY_TIMEOUT_MS,
      },
    ]);
  }

  await runTimelineSteps(ctx, [
    {
      type: "wait-for",
      selector: ".build-files-preview-selector .gds-listbox-trigger",
      timeoutMs: 120_000,
    },
    {
      type: "wait-for",
      selector: ".build-file-preview",
      timeoutMs: 120_000,
    },
    { type: "screenshot", label: "02-build-preview" },
  ]);
  assertWorkspaceContinuity(ctx.demoTarget, {
    expectedTab: "build",
    expectedWorkspaceId: canonicalWorkspaceId,
    step: "after-build-changes",
  });

  // Build-only runtime: Test/Grade/Verify timeline steps are intentionally
  // disabled after removing WorkspaceContext-driven flows.
  return;

  // Walkthrough step 5: run tests in the Test tab for every scenario.
  await runTimelineSteps(ctx, [
    { type: "click", selector: '[data-testid="nav-test"]' },
    { type: "wait-for", selector: '[data-testid="testbot-run"]' },
    { type: "wait", ms: 400 },
  ]);
  assertWorkspaceContinuity(ctx.demoTarget, {
    expectedTab: "test",
    expectedWorkspaceId: canonicalWorkspaceId,
    step: "after-test-open",
  });
  const scenarios = await waitForScenarioDecks(ctx, canonicalWorkspaceId);
  if (scenarios.length === 0) {
    throw new Error("No scenarios found for the canonical demo timeline.");
  }
  for (let i = 0; i < scenarios.length; i += 1) {
    const scenario = scenarios[i];
    const newChatButton = ctx.demoTarget.getByRole("button", {
      name: "New chat",
      exact: true,
    });
    if (await newChatButton.count() > 0) {
      await newChatButton.first().click();
      await waitForCondition(async () => {
        const status = normalizeTestStatus(
          await readTestStatusText(ctx.demoTarget),
        );
        if (status.includes("running")) return false;
        const runButton = ctx.demoTarget.locator('[data-testid="testbot-run"]');
        if ((await runButton.count()) === 0) return false;
        return await runButton.first().isEnabled();
      }, {
        timeoutMs: 30_000,
        label: "test surface ready after New chat",
      });
    }
    await runTimelineSteps(ctx, [
      {
        type: "click",
        selector: ".gds-listbox-trigger:not([aria-labelledby])",
      },
      { type: "wait-for", selector: ".gds-listbox-popover" },
    ]);
    const popover = ctx.demoTarget.locator(".gds-listbox-popover");
    await popover.getByText(scenario.label, { exact: true }).first().click();
    const beforeStatus = normalizeTestStatus(
      await readTestStatusText(ctx.demoTarget),
    );
    await runTimelineSteps(ctx, [
      { type: "wait", ms: 200 },
      { type: "click", selector: '[data-testid="testbot-run"]' },
    ]);
    await waitForCondition(async () => {
      const current = normalizeTestStatus(
        await readTestStatusText(ctx.demoTarget),
      );
      return current !== beforeStatus;
    }, { timeoutMs: 30_000, label: "test status change after run click" });
    await waitForCondition(async () => {
      const current = normalizeTestStatus(
        await readTestStatusText(ctx.demoTarget),
      );
      return current.includes("running") || isTestTerminalStatus(current);
    }, { timeoutMs: 60_000, label: "test run entered running/terminal state" });
    await waitForCondition(async () => {
      const current = normalizeTestStatus(
        await readTestStatusText(ctx.demoTarget),
      );
      return isTestTerminalStatus(current);
    }, { timeoutMs: 180_000, label: "test run terminal state" });
    const finalStatus = normalizeTestStatus(
      await readTestStatusText(ctx.demoTarget),
    );
    if (!finalStatus.includes("completed")) {
      timelineLog(
        `test run finished with non-completed status for "${scenario.label}": ${finalStatus}`,
      );
    }
    if (finalStatus.includes("completed")) {
      try {
        await waitForTestTranscriptRows(ctx.demoTarget, { timeoutMs: 45_000 });
      } catch (error) {
        const errorMessage = (error as Error).message ?? String(error);
        timelineLog(
          `test run completed without transcript rows for "${scenario.label}": ${errorMessage}`,
        );
      }
    }
    await runTimelineSteps(ctx, [
      { type: "wait", ms: 250 },
      { type: "screenshot", label: `03-test-complete-${i + 1}` },
    ]);
    assertWorkspaceContinuity(ctx.demoTarget, {
      expectedTab: "test",
      expectedWorkspaceId: canonicalWorkspaceId,
      step: `after-test-run-${i + 1}`,
    });
  }

  // Walkthrough steps 6-8: visit Grade, then return to Build.
  await runTimelineSteps(ctx, [
    { type: "click", selector: '[data-testid="nav-grade"]' },
    { type: "wait-for", selector: ".calibrate-results" },
    { type: "wait", ms: 250 },
  ]);
  await waitForConditionSoft(async () => {
    const loading = ctx.demoTarget.getByText(/Loading calibration data/i);
    if ((await loading.count()) > 0 && await loading.first().isVisible()) {
      return true;
    }
    const emptySession = ctx.demoTarget.getByText(
      /No grader runs for this session yet\./i,
    );
    if (
      (await emptySession.count()) > 0 && await emptySession.first().isVisible()
    ) {
      return true;
    }
    const emptySelectedRun = ctx.demoTarget.getByText(
      /No grader runs for this selected test run yet\./i,
    );
    if (
      (await emptySelectedRun.count()) > 0 &&
      await emptySelectedRun.first().isVisible()
    ) {
      return true;
    }
    if ((await ctx.demoTarget.locator(".calibrate-run-card").count()) > 0) {
      return true;
    }
    const runGraderButton = ctx.demoTarget.getByRole("button", {
      name: /Run grader/i,
    });
    return (await runGraderButton.count()) > 0;
  }, { timeoutMs: 15_000, label: "grade loading or ready state present" });
  try {
    await waitForTextAbsentStable(ctx.demoTarget, /Loading calibration data/i, {
      timeoutMs: 45_000,
      stableMs: 1_200,
      label: "grade loading text hidden (stable)",
    });
  } catch (error) {
    const errorMessage = (error as Error).message ?? String(error);
    timelineLog(
      `grade loading text remained visible: ${errorMessage}`,
    );
  }
  const gradeRunCardsBefore = await ctx.demoTarget.locator(
    ".calibrate-run-card",
  )
    .count();
  const runGraderButton = ctx.demoTarget.getByRole("button", {
    name: /Run grader/i,
  });
  const runGraderReady = await waitForConditionSoft(async () => {
    if ((await runGraderButton.count()) === 0) return false;
    return await runGraderButton.first().isEnabled();
  }, { timeoutMs: 20_000, label: "run grader button enabled" });
  if (runGraderReady && (await runGraderButton.count()) > 0) {
    await runGraderButton.first().click();
    const sawNewRunCard = await waitForConditionSoft(async () => {
      const now = await ctx.demoTarget.locator(".calibrate-run-card").count();
      return now > gradeRunCardsBefore;
    }, { timeoutMs: 120_000, label: "new grader run card appears" });
    if (sawNewRunCard) {
      await waitForConditionSoft(async () => {
        const firstSubtitle = ctx.demoTarget
          .locator(".calibrate-run-card")
          .first()
          .locator(".calibrate-run-subtitle");
        if ((await firstSubtitle.count()) === 0) return false;
        const text = (await firstSubtitle.first().innerText()).toLowerCase();
        return !text.includes("running");
      }, { timeoutMs: 120_000, label: "grader run reached terminal state" });
    }
  } else {
    timelineLog("run grader button unavailable; skipping grader execution");
  }
  await runTimelineSteps(ctx, [
    { type: "wait", ms: 250 },
    { type: "screenshot", label: "04-grade" },
  ]);
  assertWorkspaceContinuity(ctx.demoTarget, {
    expectedTab: "grade",
    expectedWorkspaceId: canonicalWorkspaceId,
    step: "after-grade-open",
  });
  await runTimelineSteps(ctx, [
    { type: "click", selector: '[data-testid="nav-build"]' },
    { type: "wait-for", selector: '[data-testid="build-chat-input"]' },
  ]);
  await waitForTextAbsentStable(ctx.demoTarget, /Loading files/i, {
    timeoutMs: 45_000,
    stableMs: 1_200,
    label: "build loading files hidden (stable)",
  });
  await waitForTextAbsentStable(ctx.demoTarget, /Loading preview/i, {
    timeoutMs: 45_000,
    stableMs: 1_200,
    label: "build loading preview hidden (stable)",
  });
  await runTimelineSteps(ctx, [
    { type: "wait", ms: 250 },
    { type: "screenshot", label: "05-return-build" },
  ]);
  assertWorkspaceContinuity(ctx.demoTarget, {
    expectedTab: "build",
    expectedWorkspaceId: canonicalWorkspaceId,
    step: "after-return-build",
  });
}
