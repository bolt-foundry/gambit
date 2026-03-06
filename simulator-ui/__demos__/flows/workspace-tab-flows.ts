import { waitForPath } from "../../../../demo-runner/src/e2e/utils.ts";

type WaitFn = (ms: number) => Promise<void>;

// deno-lint-ignore no-explicit-any
type DemoTarget = any;

export async function ensureWorkspaceBuildPath(
  demoTarget: DemoTarget,
  wait: WaitFn,
): Promise<string> {
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
      /^\/isograph\/workspaces\/[^/]+\/build(?:\/.*)?$/.test(pathname),
    10_000,
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

  return await waitForPath(
    demoTarget,
    wait,
    (pathname) =>
      /^\/isograph\/workspaces\/[^/]+\/build(?:\/.*)?$/.test(pathname),
    20_000,
    { label: "build tab load", logEveryMs: 250 },
  );
}

export async function runBuildSmokeFlow(
  demoTarget: DemoTarget,
): Promise<void> {
  await demoTarget.locator('[data-testid="build-chat-input"]').waitFor({
    timeout: 20_000,
  });
  const chatPrompt = `demo full-build send ${Date.now()}`;
  await demoTarget.locator('[data-testid="build-chat-input"]').fill(chatPrompt);
  const sendButton = demoTarget.locator(
    '[data-testid="build-send"]:not([disabled])',
  ).first();
  await sendButton.waitFor({ timeout: 30_000 });
  await sendButton.click();
  await demoTarget.locator('.imessage-bubble[title="user"]', {
    hasText: chatPrompt,
  }).waitFor({
    timeout: 20_000,
  });
  await demoTarget.locator(".workbench-accordion-title .badge", {
    hasText: "Running",
  }).waitFor({
    timeout: 20_000,
  });
  await demoTarget.locator('[data-testid="build-stop"]').waitFor({
    timeout: 20_000,
  });
  await demoTarget.locator('[data-testid="build-stop"]').click();
  await demoTarget.locator(
    '[data-testid="build-chat-input"]:not([disabled])',
  ).waitFor({
    timeout: 30_000,
  });
}

export async function runTestSmokeFlow(
  demoTarget: DemoTarget,
  wait: WaitFn,
): Promise<{ testPath: string; testRunPath: string }> {
  await demoTarget.locator('[data-testid="nav-test"]').waitFor({
    timeout: 10_000,
  });
  await demoTarget.locator('[data-testid="nav-test"]').click();
  const testPath = await waitForPath(
    demoTarget,
    wait,
    (pathname) =>
      /^\/isograph\/workspaces\/[^/]+\/test(?:\/[^/]+)?$/.test(pathname),
    10_000,
    { label: "test tab load", logEveryMs: 250 },
  );
  await demoTarget.locator('[data-testid="test-tab-scaffold"]').waitFor({
    timeout: 10_000,
  });
  await demoTarget.locator('[data-testid="testbot-run"]').waitFor({
    timeout: 10_000,
  });
  const runButton = demoTarget.locator(
    '[data-testid="testbot-run"]:not([disabled])',
  ).first();
  await runButton.waitFor({ timeout: 20_000 });
  await runButton.click();
  const testRunPath = await waitForPath(
    demoTarget,
    wait,
    (pathname) => /^\/isograph\/workspaces\/[^/]+\/test\/[^/]+$/.test(pathname),
    40_000,
    { label: "test run path", logEveryMs: 250 },
  );
  return { testPath, testRunPath };
}

export async function runGradeSmokeFlow(
  demoTarget: DemoTarget,
  wait: WaitFn,
): Promise<string> {
  await demoTarget.locator('[data-testid="nav-grade"]').waitFor({
    timeout: 10_000,
  });
  await demoTarget.locator('[data-testid="nav-grade"]').click();
  await waitForPath(
    demoTarget,
    wait,
    (pathname) =>
      /^\/isograph\/workspaces\/[^/]+\/grade(?:\/[^/]+)?$/.test(pathname),
    10_000,
    { label: "grade tab load", logEveryMs: 250 },
  );
  await demoTarget.locator('[data-testid="grade-run-grader"]').waitFor({
    timeout: 10_000,
  });
  await demoTarget.locator('[data-testid="grade-run-grader"]').click();
  const gradeRunPath = await waitForPath(
    demoTarget,
    wait,
    (pathname) =>
      /^\/isograph\/workspaces\/[^/]+\/grade\/[^/]+$/.test(pathname),
    60_000,
    { label: "grade run deep-link", logEveryMs: 500 },
  );
  await demoTarget.locator('[data-testid^="grade-run-"]').first().waitFor({
    timeout: 15_000,
  });
  return gradeRunPath;
}

export async function runVerifySmokeFlow(
  demoTarget: DemoTarget,
  wait: WaitFn,
): Promise<string> {
  await demoTarget.locator('[data-testid="nav-verify"]').waitFor({
    timeout: 10_000,
  });
  await demoTarget.locator('[data-testid="nav-verify"]').click();
  const verifyPath = await waitForPath(
    demoTarget,
    wait,
    (pathname) => /^\/isograph\/workspaces\/[^/]+\/verify$/.test(pathname),
    15_000,
    { label: "verify tab load", logEveryMs: 250 },
  );
  await demoTarget.locator('[data-testid="verify-tab-scaffold"]').waitFor({
    timeout: 10_000,
  });

  const scenarioRunsInput = demoTarget.locator(
    'label.verify-number-field:has-text("Scenario runs") input',
  ).first();
  await scenarioRunsInput.fill("1");
  const graderRepeatsInput = demoTarget.locator(
    'label.verify-number-field:has-text("Grader repeats per scenario") input',
  ).first();
  await graderRepeatsInput.fill("1");
  const concurrencyInput = demoTarget.locator(
    'label.verify-number-field:has-text("Concurrency") input',
  ).first();
  await concurrencyInput.fill("1");

  await demoTarget.locator(
    '[data-testid="verify-run-batch"]:not([disabled])',
  ).first().waitFor({
    timeout: 10_000,
  });
  await demoTarget.locator(
    '[data-testid="verify-run-batch"]:not([disabled])',
  ).first().click();

  const requestRows = demoTarget.locator(
    '.verify-section:has(strong:has-text("Batch requests")) .verify-request-row',
  );
  const verifyRowsDeadline = Date.now() + 240_000;
  let sawVerifyRows = false;
  while (Date.now() < verifyRowsDeadline) {
    const rowCount = await requestRows.count();
    if (rowCount > 0) {
      sawVerifyRows = true;
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
  if (!sawVerifyRows) {
    throw new Error("Verify batch requests never rendered in full demo.");
  }
  const verifyCompletionDeadline = Date.now() + 240_000;
  let verifyComplete = false;
  while (Date.now() < verifyCompletionDeadline) {
    let statuses: Array<string>;
    try {
      statuses = await requestRows.locator(".badge").allTextContents();
    } catch {
      statuses = [];
    }
    if (
      statuses.length > 0 &&
      statuses.every((status) => {
        const normalized = status.trim().toLowerCase();
        return normalized === "completed" || normalized === "error";
      })
    ) {
      verifyComplete = true;
      break;
    }
    await wait(500);
  }
  if (!verifyComplete) {
    throw new Error(
      "Verify batch requests did not reach terminal status in full demo.",
    );
  }

  return verifyPath;
}
