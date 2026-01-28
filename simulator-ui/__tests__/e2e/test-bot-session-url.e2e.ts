import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { createE2eTestContext } from "./utils/mod.ts";

function findAvailablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSessionId(pathname: string): string | null {
  const match = pathname.match(/^\/sessions\/([^/]+)\/(test|grade)$/);
  return match ? match[1] : null;
}

type StepResult = { label: string; status: "passed" | "failed" };

function recordStep(
  steps: StepResult[],
  label: string,
  status: StepResult["status"],
) {
  steps.push({ label, status });
}

function printChecklist(steps: StepResult[]) {
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const reset = "\x1b[0m";
  const lines = steps.map((step) =>
    `${
      step.status === "passed" ? `${green}✓` : `${red}✗`
    }${reset} ${step.label} - ${
      step.status === "passed"
        ? `${green}passed${reset}`
        : `${red}failed${reset}`
    }`
  );
  console.info(`[e2e checklist]\n${lines.join("\n")}`);
}

type StepError = { label: string; error: Error };

function isTransientActionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /detached|Target closed|Connection closed|Execution context was destroyed|Cannot find context|Frame was detached|detached Frame|Attempted to use detached Frame/i
    .test(message);
}

async function safeClick(
  ctx: { click(selector: string): Promise<void> },
  selector: string,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await ctx.click(selector);
      return;
    } catch (err) {
      if (!isTransientActionError(err)) throw err;
      await wait(300);
    }
  }
  throw new Error(`Timed out clicking ${selector}`);
}

async function runStep(
  steps: StepResult[],
  errors: StepError[],
  label: string,
  fn: () => Promise<void>,
) {
  try {
    await fn();
    recordStep(steps, label, "passed");
  } catch (err) {
    recordStep(steps, label, "failed");
    errors.push({
      label,
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }
}

async function waitForSessionPathChange(
  ctx: { currentPath(): Promise<string> },
  prevPath: string,
  timeoutMs = 4_000,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const path = await ctx.currentPath();
      if (path !== prevPath && !path.endsWith("/new/test")) return path;
    } catch {
      // transient navigation/frame detach; retry until timeout
    }
    await wait(300);
  }
  return null;
}

async function waitForSelector(
  ctx: { exists(selector: string): Promise<boolean> },
  selector: string,
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await ctx.exists(selector)) return;
    await wait(300);
  }
  throw new Error(`Timed out waiting for selector ${selector}`);
}

async function clickRunTestBot(
  ctx: {
    click(selector: string): Promise<void>;
    exists(selector: string): Promise<boolean>;
  },
): Promise<void> {
  const overlaySelector = '[data-testid="testbot-run-overlay"]';
  if (await ctx.exists(overlaySelector)) {
    await safeClick(ctx, overlaySelector);
    return;
  }
  await waitForSelector(ctx, '[data-testid="testbot-run"]:not([disabled])');
  await safeClick(ctx, '[data-testid="testbot-run"]');
}

Deno.test("test bot navigation preserves session ids across flows", async (t) => {
  Deno.env.set("GAMBIT_E2E_SHOW_BROWSER", "false");
  const port = findAvailablePort();
  const deckPath =
    "scaffolds/demo/examples/advanced/simpsons_explainer/root.deck.md";
  const command = [
    "deno",
    "run",
    "-A",
    "simulator-ui/__tests__/e2e/fixtures/stub-simulator-server.ts",
    "--port",
    String(port),
    "--deck",
    deckPath,
  ];

  await using ctx = await createE2eTestContext(t.name, {
    server: { command, port },
  });

  const steps: StepResult[] = [];
  let firstSessionId: string | null = null;
  let secondSessionId: string | null = null;
  let selectedSessionId: string | null = null;
  let selectedPath = "";
  let firstPath = "";
  const errors: StepError[] = [];

  await runStep(
    steps,
    errors,
    "Navigate to /sessions/new/test",
    async () => {
      await ctx.navigate("/sessions/new/test");
      await ctx.waitForUrl(/\/sessions\/new\/test$/);
    },
  );

  await runStep(
    steps,
    errors,
    "Run test bot - url changes",
    async () => {
      await clickRunTestBot(ctx);
      const nextPath = await waitForSessionPathChange(
        ctx,
        "/sessions/new/test",
      );
      if (!nextPath) {
        throw new Error("URL did not change after running test bot");
      }
      firstPath = nextPath;
      firstSessionId = extractSessionId(firstPath);
      assert(firstSessionId, "expected first session id from run");
    },
  );

  await runStep(
    steps,
    errors,
    "Run test bot again - url changes",
    async () => {
      await clickRunTestBot(ctx);
      const secondPath = await waitForSessionPathChange(ctx, firstPath);
      if (!secondPath) {
        throw new Error("URL did not change after running test bot again");
      }
      secondSessionId = extractSessionId(secondPath);
      assert(secondSessionId, "expected second session id from run");
      assertNotEquals(secondSessionId, firstSessionId);
    },
  );

  await runStep(
    steps,
    errors,
    "Choose previous session from list - url changes",
    async () => {
      await ctx.click('[data-testid="nav-sessions"]');
      await waitForSelector(ctx, ".session-select-button:not(.active)");
      await ctx.click(".session-select-button:not(.active)");
      await ctx.waitForUrl(/\/sessions\/[^/]+\/test$/);
      selectedPath = await ctx.currentPath();
      selectedSessionId = extractSessionId(selectedPath);
      assert(selectedSessionId, "expected selected session id");
      assertNotEquals(selectedSessionId, secondSessionId);
    },
  );

  await runStep(
    steps,
    errors,
    "Refresh page - url stays the same",
    async () => {
      if (!selectedPath) {
        throw new Error("No selected session path available");
      }
      await ctx.navigate(selectedPath);
      await ctx.waitForUrl(/\/sessions\/[^/]+\/test$/);
      const refreshedPath = await ctx.currentPath();
      assertEquals(refreshedPath, selectedPath);
    },
  );

  await runStep(
    steps,
    errors,
    "Grade tab - url id stays the same",
    async () => {
      await safeClick(ctx, '[data-testid="nav-grade"]');
      await ctx.waitForUrl(/\/sessions\/[^/]+\/grade$/);
      const gradePath = await ctx.currentPath();
      const gradeSessionId = extractSessionId(gradePath);
      assertEquals(gradeSessionId, selectedSessionId);
    },
  );

  await runStep(
    steps,
    errors,
    "Test tab - url id stays the same",
    async () => {
      await safeClick(ctx, '[data-testid="nav-test"]');
      await ctx.waitForUrl(/\/sessions\/[^/]+\/test$/);
      const backToTestPath = await ctx.currentPath();
      const backToTestSessionId = extractSessionId(backToTestPath);
      assertEquals(backToTestSessionId, selectedSessionId);
    },
  );

  printChecklist(steps);
  if (errors.length > 0) {
    const details = errors.map((entry) =>
      `${entry.label}: ${entry.error.message}`
    ).join("\n");
    throw new Error(`One or more steps failed:\n${details}`);
  }
});
