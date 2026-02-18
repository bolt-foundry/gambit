import { defineDeck } from "../../../src/definitions.ts";
import { z } from "zod";
import { sendCodexTurn } from "./codex_client.ts";

const CODEX_THREAD_META_KEY = "codex.threadId";

export default defineDeck({
  label: "codex_sdk_bridge",
  contextSchema: z.string().optional(),
  responseSchema: z.string(),
  async run(ctx) {
    const userText = typeof ctx.initialUserMessage === "string" &&
        ctx.initialUserMessage.trim()
      ? ctx.initialUserMessage.trim()
      : typeof ctx.input === "string" && ctx.input.trim()
      ? ctx.input.trim()
      : "";

    if (!userText) return "";

    const priorThreadId = ctx.getSessionMeta<string>(CODEX_THREAD_META_KEY);
    const systemPrompt = ctx.getSessionMeta<string>("codex.systemPrompt");

    ctx.appendMessage({ role: "user", content: userText });

    const result = await sendCodexTurn({
      userText,
      threadId: priorThreadId,
      systemPrompt,
    });

    ctx.setSessionMeta(CODEX_THREAD_META_KEY, result.threadId);
    ctx.appendMessage({ role: "assistant", content: result.assistantText });
    return result.assistantText;
  },
});
