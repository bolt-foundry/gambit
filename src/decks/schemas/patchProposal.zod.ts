import { z } from "zod";

export const replaceRangeEditSchema = z.object({
  start: z.number().int().min(0)
    .describe("0-based character offset where the replacement starts"),
  end: z.number().int().min(0)
    .describe("0-based, exclusive character offset where the replacement ends"),
  text: z.string().describe("Replacement text for the range"),
}).superRefine((value, ctx) => {
  if (value.end < value.start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "`end` must be >= `start`",
      path: ["end"],
    });
  }
});

export const patchProposalSchema = z.object({
  summary: z.string().min(1).max(500)
    .describe("1–3 sentence summary of the proposed edits"),
  edits: z.array(replaceRangeEditSchema).min(1).describe(
    "Sorted, non-overlapping replace-range edits to apply in order",
  ),
}).superRefine((value, ctx) => {
  let lastEnd = 0;
  value.edits.forEach((edit, idx) => {
    if (idx > 0 && edit.start < lastEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Edits must be sorted by start and non-overlapping",
        path: ["edits", idx, "start"],
      });
    }
    lastEnd = Math.max(lastEnd, edit.end);
  });
});

export type ReplaceRangeEdit = z.infer<typeof replaceRangeEditSchema>;
export type PatchProposal = z.infer<typeof patchProposalSchema>;

export default patchProposalSchema;
