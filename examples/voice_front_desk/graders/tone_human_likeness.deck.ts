import { defineDeck } from "../../../mod.ts";
import sessionInputSchema from "../schemas/calibration_session_input.zod.ts";
import outputSchema from "../schemas/fact_verifier_output.zod.ts";

function parseGraderOutput(raw: string): {
  score: number;
  reason: string;
  evidence?: string[];
} {
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  const nonEmpty = lines.filter((line) => line.length > 0);
  const scoreLine = nonEmpty[0] ?? "";
  const scoreValue = Number(scoreLine);
  const score = Number.isFinite(scoreValue)
    ? Math.max(-3, Math.min(3, Math.round(scoreValue)))
    : 0;
  const reason = nonEmpty[1] ?? "No reason provided.";
  const evidence = nonEmpty.length > 2
    ? nonEmpty.slice(2).filter(Boolean)
    : undefined;
  return evidence && evidence.length > 0
    ? { score, reason, evidence }
    : { score, reason };
}

export default defineDeck({
  label: "tone_human_likeness",
  inputSchema: sessionInputSchema,
  outputSchema,
  async run(ctx) {
    const raw = await ctx.spawnAndWait({
      path: "./tone_human_likeness_llm.deck.md",
      input: ctx.input,
    });
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    return parseGraderOutput(text);
  },
});
