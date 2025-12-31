#!/usr/bin/env -S deno run -A

import { type DemoScenarioContext, runDemo } from "./gambit-ui-demo-runner.ts";

async function runScenario(ctx: DemoScenarioContext): Promise<void> {
  const { demoTarget, page, baseUrl, useIframeShell, wait, screenshot } = ctx;
  let sessionId: string | null = null;

  const personaSelect = demoTarget.locator(".test-bot-sidebar select");
  let selectedNewPatient = false;
  try {
    await personaSelect.waitFor({ timeout: 10_000 });
    await personaSelect.selectOption({ label: "New patient intake" });
    await wait(600);
    selectedNewPatient = true;
  } catch (error) {
    console.warn("[gambit-demo] persona selection failed:", error);
  }

  const fillInitField = async (
    label: string,
    value: string,
  ): Promise<void> => {
    const field = demoTarget.locator(".init-field", { hasText: label })
      .locator("input");
    try {
      await field.fill(value, { timeout: 5_000 });
    } catch (error) {
      console.warn(`[gambit-demo] init field "${label}" not found:`, error);
    }
  };

  if (selectedNewPatient) {
    await fillInitField(
      "scenarioDescription",
      "Caller wants to book a first visit next week, prefers Monday or Thursday mornings, has Blue Cross PPO, and will share name, DOB, and callback when asked.",
    );
    await fillInitField("callerName", "Avery Blake");
    await fillInitField("dob", "1992-08-12");
  }

  const runButton = demoTarget.locator('[data-testid="testbot-run"]');
  if (await runButton.count()) {
    await runButton.click();
    await wait(1200);
    await screenshot("02-test-bot-running");

    const sessionLabel = demoTarget.locator(
      'code[data-testid="testbot-session-id"]',
    );
    try {
      await sessionLabel.waitFor({ timeout: 20_000 });
      sessionId = (await sessionLabel.textContent())?.trim() || null;
      await screenshot("03-test-bot-session-created");
    } catch (_) {
      // ignore missing session
    }

    const stopButton = demoTarget.locator('[data-testid="testbot-stop"]');
    if (await stopButton.count()) {
      await stopButton.click().catch(() => {});
    }
  }

  await demoTarget.locator('[data-testid="nav-calibrate"]').click();
  await demoTarget.waitForURL(/\/calibrate(?:$|\/)/, { timeout: 15_000 });
  await demoTarget.waitForSelector(".calibrate-shell h1", {
    timeout: 10_000,
  });
  await wait(800);
  if (useIframeShell) {
    try {
      await page.evaluate(() => {
        return (window as {
          gambitDemo?: {
            zoomTo?: (sel: string, opts?: Record<string, unknown>) => unknown;
          };
        })
          .gambitDemo?.zoomTo?.('[data-testid="nav-calibrate"]', {
            padding: 120,
            maxScale: 2.2,
            durationMs: 800,
          });
      });
      await wait(600);
    } catch (error) {
      console.warn("[gambit-demo] iframe zoom failed:", error);
    }
  }
  await screenshot("04-calibrate");

  if (sessionId) {
    await demoTarget.goto(
      `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/debug`,
      {
        waitUntil: "domcontentloaded",
      },
    );
  } else {
    await demoTarget.locator('[data-testid="nav-debug"]').click();
  }
  await demoTarget.waitForURL(/\/debug$/, { timeout: 15_000 });
  await demoTarget.waitForSelector(
    'textarea[data-testid="debug-message-input"]',
    {
      timeout: 10_000,
    },
  );
  await wait(500);
  if (useIframeShell) {
    try {
      await page.evaluate(() => {
        const frame = document.querySelector<HTMLIFrameElement>(
          "#demo-frame",
        );
        const win = frame?.contentWindow;
        const doc = win?.document;
        const scrollEl = doc?.scrollingElement || doc?.documentElement;
        if (scrollEl) {
          scrollEl.scrollTo({
            top: scrollEl.scrollHeight,
            behavior: "smooth",
          });
        }
      });
      await wait(800);
    } catch (error) {
      console.warn("[gambit-demo] debug scroll failed:", error);
    }
  }
  await screenshot("05-debug");

  const shouldInteract = (Deno.env.get("GAMBIT_DEMO_INTERACT_DEBUG") || "")
    .toLowerCase()
    .trim() === "true";
  if (shouldInteract) {
    try {
      const debugInput = demoTarget.locator(
        'textarea[data-testid="debug-message-input"]',
      );
      await debugInput.fill("Hello! Can you summarize what this deck does?");
      await wait(300);
      await demoTarget.locator('[data-testid="debug-send"]').click();
      await wait(1200);
      await screenshot("06-debug-after-send");
    } catch (error) {
      console.warn("[gambit-demo] debug interaction failed:", error);
      await screenshot("06-debug-interaction-failed");
    }
  }
}

if (import.meta.main) {
  await runDemo(runScenario);
}
