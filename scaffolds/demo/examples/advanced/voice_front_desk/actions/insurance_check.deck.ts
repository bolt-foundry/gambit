import { defineDeck } from "jsr:@molt-foundry/gambit";
import { z } from "npm:zod";

const insuranceDetails = z.object({
  carrier: z.string(),
  memberId: z.string(),
  holder: z.string().optional(),
});

const contextSchema = z.object({
  patientId: z.string().optional(),
  operation: z.enum(["verify_on_file", "collect_new"]),
  insurance: insuranceDetails,
});

const responseSchema = z.object({
  eligibility: z.enum(["eligible", "ineligible", "unknown"]),
  summary: z.string(),
  nextSteps: z.string(),
});

export default defineDeck({
  label: "insurance_check",
  contextSchema,
  responseSchema,
  run(ctx) {
    const eligible = ctx.input.insurance.carrier.toLowerCase() !== "unknown";
    return {
      eligibility: eligible ? "eligible" : "unknown",
      summary: eligible
        ? `Coverage active under ${ctx.input.insurance.carrier}.`
        : "Unable to confirm coverage; manual follow-up required.",
      nextSteps: eligible
        ? "Proceed with scheduling or visit prep."
        : "Collect alternate insurance or set up self-pay consent.",
    };
  },
});
