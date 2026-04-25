#!/usr/bin/env -S deno run -A

import { runE2e } from "./e2e/utils.ts";

const DEFAULT_BASE_URL = "https://buildless.boltfoundry.bflocal";
const DEFAULT_PROMPT =
  "What is Gambit, and what should I ask next as an investor?";

type StreamMilestone = {
  name: string;
  elapsedMs: number;
  details?: Record<string, unknown>;
};

function printMilestone(milestone: StreamMilestone): void {
  Deno.stdout.writeSync(
    new TextEncoder().encode(
      `[faq-chat-demo] ${milestone.name} +${milestone.elapsedMs}ms${
        milestone.details ? ` ${JSON.stringify(milestone.details)}` : ""
      }\n`,
    ),
  );
}

async function main(): Promise<void> {
  const baseUrl = Deno.env.get("GAMBIT_FAQ_CHAT_DEMO_BASE_URL")?.trim() ||
    DEFAULT_BASE_URL;
  const prompt = Deno.env.get("GAMBIT_FAQ_CHAT_DEMO_PROMPT")?.trim() ||
    DEFAULT_PROMPT;
  const timeoutMs = Number(
    Deno.env.get("GAMBIT_FAQ_CHAT_DEMO_TIMEOUT_MS")?.trim() ?? "90000",
  );

  await runE2e(
    "gambit faq chat stream demo",
    async ({ demoTarget, screenshot, wait }) => {
      await demoTarget.locator(".gambit-chat-header-title").waitFor({
        timeout: 30_000,
      });
      await screenshot("01-faq-chat-loaded");

      const input = demoTarget.locator(".gambit-chat-search-input").first();
      const submit = demoTarget.locator(
        '.gambit-chat-search button[type="submit"]',
      ).first();

      await input.waitFor({ timeout: 15_000 });
      await input.fill(prompt);
      await submit.click();
      const startedAt = Date.now();
      printMilestone({ name: "prompt_submitted", elapsedMs: 0 });

      let sawFirstText = false;
      let sawCitations = false;
      let sawFollowups = false;
      let lastAssistantLength = 0;
      let stableTicks = 0;
      const maxTicks = Math.max(40, Math.ceil(timeoutMs / 250));

      for (let tick = 0; tick < maxTicks; tick += 1) {
        const assistantText = (await demoTarget
          .locator(".gambit-chat-bubble--assistant .gambit-chat-bubble-body")
          .last()
          .innerText()
          .catch(() => ""))?.trim() ?? "";
        const citationCount = await demoTarget
          .locator(".gambit-chat-bubble-citations a")
          .count();
        const followupCount = await demoTarget
          .locator(".gambit-chat-followups-list .gambit-chat-followup-line")
          .count();

        if (!sawFirstText && assistantText.length > 0) {
          sawFirstText = true;
          printMilestone({
            name: "first_assistant_text",
            elapsedMs: Date.now() - startedAt,
            details: { chars: assistantText.length },
          });
          await screenshot("02-first-assistant-text");
        }

        if (!sawCitations && citationCount > 0) {
          sawCitations = true;
          printMilestone({
            name: "citations_visible",
            elapsedMs: Date.now() - startedAt,
            details: { count: citationCount },
          });
          await screenshot("03-citations-visible");
        }

        if (!sawFollowups && followupCount > 0) {
          sawFollowups = true;
          printMilestone({
            name: "followups_visible",
            elapsedMs: Date.now() - startedAt,
            details: { count: followupCount },
          });
          await screenshot("04-followups-visible");
        }

        if (assistantText.length === lastAssistantLength) {
          stableTicks += 1;
        } else {
          stableTicks = 0;
          lastAssistantLength = assistantText.length;
        }

        if (sawFirstText && stableTicks >= 8 && sawCitations && sawFollowups) {
          break;
        }

        await wait(250);
      }

      const finalText = (await demoTarget
        .locator(".gambit-chat-bubble--assistant .gambit-chat-bubble-body")
        .last()
        .innerText()
        .catch(() => ""))?.trim() ?? "";
      const finalCitationCount = await demoTarget
        .locator(".gambit-chat-bubble-citations a")
        .count();
      const finalFollowupCount = await demoTarget
        .locator(".gambit-chat-followups-list .gambit-chat-followup-line")
        .count();

      printMilestone({
        name: "stream_summary",
        elapsedMs: Date.now() - startedAt,
        details: {
          assistantChars: finalText.length,
          citations: finalCitationCount,
          followups: finalFollowupCount,
          sawFirstText,
          sawCitations,
          sawFollowups,
        },
      });
      await screenshot("05-stream-summary");
    },
    {
      slug: Deno.env.get("GAMBIT_DEMO_SLUG")?.trim() ||
        "gambit-faq-chat-stream-demo",
      baseUrl,
      iframeTargetPath: "/gambit-chat",
    },
  );
}

if (import.meta.main) {
  await main();
}
