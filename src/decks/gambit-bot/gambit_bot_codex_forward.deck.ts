import { defineDeck } from "jsr:@bolt-foundry/gambit";
import * as path from "@std/path";

const CODEX_SDK_DECK_PATH = path.resolve(
  path.dirname(path.fromFileUrl(import.meta.url)),
  "../../../packages/gambit-core/decks/openai/codex-sdk/PROMPT.md",
);
const CODEX_THREAD_META_KEY = "codex.threadId";

function pickThreadId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const direct = typeof obj.threadId === "string" && obj.threadId.trim()
    ? obj.threadId.trim()
    : typeof obj.thread_id === "string" && obj.thread_id.trim()
    ? obj.thread_id.trim()
    : undefined;
  if (direct) return direct;
  const payload = obj.payload;
  if (payload && typeof payload === "object") {
    const payloadObj = payload as Record<string, unknown>;
    const nested = typeof payloadObj.threadId === "string" &&
        payloadObj.threadId.trim()
      ? payloadObj.threadId.trim()
      : typeof payloadObj.thread_id === "string" && payloadObj.thread_id.trim()
      ? payloadObj.thread_id.trim()
      : undefined;
    if (nested) return nested;
  }
  return undefined;
}

export default defineDeck({
  label: "gambit_bot_codex_forward",
  async run(ctx) {
    try {
      await Deno.stat(CODEX_SDK_DECK_PATH);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new Error(
          `Codex SDK deck not found at ${CODEX_SDK_DECK_PATH}`,
        );
      }
      throw err;
    }

    const priorThreadId = ctx.getSessionMeta<string>(CODEX_THREAD_META_KEY);
    const result = await ctx.spawnAndWait({
      path: CODEX_SDK_DECK_PATH,
      input: ctx.input,
    });

    const returnedThreadId = pickThreadId(result);
    if (returnedThreadId) {
      ctx.setSessionMeta(CODEX_THREAD_META_KEY, returnedThreadId);
    } else if (priorThreadId) {
      ctx.setSessionMeta(CODEX_THREAD_META_KEY, priorThreadId);
    }
    return result;
  },
});
