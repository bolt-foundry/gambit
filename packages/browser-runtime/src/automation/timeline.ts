import type { DemoScenarioContext } from "@bolt-foundry/browser-runtime/src/runnerTypes.ts";
import {
  shouldShowDemoSubtitles,
  shouldUseSmoothMouse,
  shouldUseSmoothType,
} from "@bolt-foundry/browser-runtime/src/config.ts";
import { moveMouseToLocator, typeIntoLocator } from "./interaction.ts";

type DemoTimelineStep =
  | {
    type: "subtitle";
    text: string;
    durationMs?: number;
  }
  | {
    type: "voiceover";
    text: string;
    rate?: number;
    pitch?: number;
    lang?: string;
    voiceName?: string;
    showSubtitles?: boolean;
    blocking?: boolean;
  }
  | {
    type: "wait";
    ms: number;
  }
  | {
    type: "wait-for";
    selector?: string;
    text?: string | RegExp;
    timeoutMs?: number;
    state?: "attached" | "visible" | "hidden" | "detached";
    exact?: boolean;
  }
  | {
    type: "click";
    selector?: string;
    text?: string;
    move?: boolean;
  }
  | {
    type: "type";
    selector: string;
    text: string;
    clear?: boolean;
    delayMs?: number;
  }
  | {
    type: "scroll";
    selector?: string;
    y?: number;
  }
  | {
    type: "zoom";
    selector: string;
    durationMs?: number;
    padding?: number;
    maxScale?: number;
  }
  | {
    type: "zoom-reset";
    durationMs?: number;
  }
  | {
    type: "screenshot";
    label: string;
  }
  | {
    type: "custom";
    run: (ctx: DemoScenarioContext) => Promise<void> | void;
  };
type SubtitleStep = Extract<DemoTimelineStep, { type: "subtitle" }>;
type VoiceoverStep = Extract<DemoTimelineStep, { type: "voiceover" }>;
type ScrollStep = Extract<DemoTimelineStep, { type: "scroll" }>;
type ZoomStep = Extract<DemoTimelineStep, { type: "zoom" }>;
type ZoomResetStep = Extract<DemoTimelineStep, { type: "zoom-reset" }>;

function resolveTarget(
  demoTarget: DemoScenarioContext["demoTarget"],
  step: { selector?: string; text?: string },
) {
  if (step.selector) return demoTarget.locator(step.selector);
  if (step.text) return demoTarget.getByText(step.text, { exact: true });
  return null;
}

function isActionLoggingEnabled(): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_ACTION_LOG") || "").trim()
    .toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function formatStep(step: DemoTimelineStep): string {
  if (step.type === "wait") return `wait ${step.ms}ms`;
  if (step.type === "wait-for") {
    const target = step.selector
      ? `selector=${step.selector}`
      : `text=${String(step.text ?? "")}`;
    return `wait-for ${target} timeout=${step.timeoutMs ?? 10_000}ms`;
  }
  if (step.type === "click") {
    const target = step.selector
      ? `selector=${step.selector}`
      : `text=${String(step.text ?? "")}`;
    return `click ${target}`;
  }
  if (step.type === "type") {
    const preview = step.text.replace(/\s+/g, " ").slice(0, 80);
    return `type selector=${step.selector} chars=${step.text.length} "${preview}${
      step.text.length > 80 ? "..." : ""
    }"`;
  }
  if (step.type === "scroll") {
    if (step.selector) return `scroll selector=${step.selector}`;
    return `scroll y=${String(step.y ?? 0)}`;
  }
  if (step.type === "zoom") return `zoom selector=${step.selector}`;
  if (step.type === "zoom-reset") return "zoom-reset";
  if (step.type === "screenshot") return `screenshot ${step.label}`;
  if (step.type === "subtitle") return `subtitle "${step.text}"`;
  if (step.type === "voiceover") return `voiceover "${step.text}"`;
  return "custom step";
}

function logStep(message: string): void {
  if (!isActionLoggingEnabled()) return;
  Deno.stdout.writeSync(
    new TextEncoder().encode(
      `[demo-step] ${new Date().toISOString()} ${message}\n`,
    ),
  );
}

async function withWaitHeartbeat<T>(
  description: string,
  run: () => Promise<T>,
): Promise<T> {
  if (!isActionLoggingEnabled()) return await run();
  const startedAt = Date.now();
  const interval = setInterval(() => {
    logStep(`pending: ${description} (+${Date.now() - startedAt}ms)`);
  }, 5_000);
  try {
    return await run();
  } finally {
    clearInterval(interval);
  }
}

export async function runTimelineSteps(
  ctx: DemoScenarioContext,
  steps: Array<DemoTimelineStep>,
): Promise<void> {
  const { demoTarget, page, wait } = ctx;
  const total = steps.length;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const prefix = `${index + 1}/${total}`;
    const startedAt = Date.now();
    logStep(`${prefix} start: ${formatStep(step)}`);
    if (step.type === "wait") {
      await wait(step.ms);
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
    if (step.type === "wait-for") {
      const timeoutMs = step.timeoutMs ?? 10_000;
      const state = step.state ?? "visible";
      if (step.selector) {
        let locator = demoTarget.locator(step.selector);
        if (step.text !== undefined) {
          locator = locator.filter({ hasText: step.text });
        }
        await withWaitHeartbeat(
          `wait-for selector=${step.selector} state=${state}`,
          () => locator.waitFor({ timeout: timeoutMs, state }),
        );
        logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
        continue;
      }
      if (step.text !== undefined) {
        const locator = typeof step.text === "string"
          ? demoTarget.getByText(step.text, { exact: step.exact ?? true })
          : demoTarget.getByText(step.text);
        await withWaitHeartbeat(
          `wait-for text=${String(step.text)} state=${state}`,
          () => locator.waitFor({ timeout: timeoutMs, state }),
        );
      }
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
    if (step.type === "subtitle") {
      if (!shouldShowDemoSubtitles()) {
        logStep(`${prefix} skipped (subtitles disabled)`);
        continue;
      }
      await page.evaluate((payload: SubtitleStep) => {
        const demo = (window as {
          gambitDemo?: {
            subtitles?: {
              show?: (text: string, opts?: { forMs?: number }) => void;
            };
          };
        }).gambitDemo;
        demo?.subtitles?.show?.(payload.text, { forMs: payload.durationMs });
      }, step);
      if (step.durationMs) {
        await wait(step.durationMs);
      }
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
    if (step.type === "voiceover") {
      const voiceoverStep = shouldShowDemoSubtitles()
        ? step
        : { ...step, showSubtitles: false };
      const runVoiceover = () =>
        page.evaluate((payload: VoiceoverStep) => {
          const demo = (window as {
            gambitDemo?: {
              voiceover?: {
                speak?: (opts: {
                  text: string;
                  rate?: number;
                  pitch?: number;
                  lang?: string;
                  voiceName?: string;
                  showSubtitles?: boolean;
                }) => Promise<void> | void;
              };
            };
          }).gambitDemo;
          return demo?.voiceover?.speak?.(payload);
        }, voiceoverStep);
      if (step.blocking === false) {
        void runVoiceover();
        logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
        continue;
      }
      await runVoiceover();
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
    if (step.type === "click") {
      const locator = resolveTarget(demoTarget, step);
      if (!locator) continue;
      if (step.move !== false && shouldUseSmoothMouse()) {
        await moveMouseToLocator(page, locator);
      }
      await locator.click();
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
    if (step.type === "type") {
      const locator = demoTarget.locator(step.selector);
      await typeIntoLocator(locator, step.text, {
        clear: step.clear,
        delayMs: step.delayMs ?? (shouldUseSmoothType() ? undefined : 0),
      });
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
    if (step.type === "scroll") {
      if (step.selector) {
        await demoTarget.locator(step.selector).scrollIntoViewIfNeeded();
      } else if (typeof step.y === "number") {
        await page.evaluate((payload: ScrollStep) => {
          const frame = document.querySelector<HTMLIFrameElement>(
            "#demo-frame",
          );
          const win = frame?.contentWindow;
          const doc = win?.document;
          const scrollEl = doc?.scrollingElement || doc?.documentElement;
          if (scrollEl) {
            scrollEl.scrollTo({ top: payload.y, behavior: "smooth" });
          }
        }, step);
      }
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
    if (step.type === "zoom") {
      await page.evaluate((payload: ZoomStep) => {
        const demo = (window as {
          gambitDemo?: {
            zoomTo?: (
              selector: string,
              opts?: {
                durationMs?: number;
                padding?: number;
                maxScale?: number;
              },
            ) => Promise<void> | void;
          };
        }).gambitDemo;
        return demo?.zoomTo?.(payload.selector, {
          durationMs: payload.durationMs,
          padding: payload.padding,
          maxScale: payload.maxScale,
        });
      }, step);
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
    if (step.type === "zoom-reset") {
      await page.evaluate((payload: ZoomResetStep) => {
        const demo = (window as {
          gambitDemo?: {
            resetZoom?: (
              opts?: { durationMs?: number },
            ) => Promise<void> | void;
          };
        }).gambitDemo;
        return demo?.resetZoom?.({ durationMs: payload.durationMs });
      }, step);
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
    if (step.type === "screenshot") {
      await ctx.screenshot(step.label);
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
    if (step.type === "custom") {
      await step.run(ctx);
      logStep(`${prefix} done (${Date.now() - startedAt}ms)`);
      continue;
    }
  }
}
