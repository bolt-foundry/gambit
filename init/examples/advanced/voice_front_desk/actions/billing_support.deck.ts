import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

const inputSchema = z.object({
  patientId: z.string().optional(),
  concern: z.string(),
  amount: z.string().optional(),
  invoiceId: z.string().optional(),
});

const outputSchema = z.object({
  answer: z.string(),
  followUp: z.string(),
  escalate: z.boolean().default(false),
});

export default defineDeck({
  label: "billing_support",
  inputSchema,
  outputSchema,
  run(ctx) {
    const escalate = ctx.input.invoiceId === undefined;
    const answer = ctx.input.amount
      ? `Noted the ${ctx.input.amount} concern. We will review the statement and email an updated breakdown.`
      : "Billing team will review the account and follow up within two business days.";
    const followUp = escalate
      ? "Route to billing queue with invoice research flag."
      : "Apply courtesy credit review before calling the patient.";

    return { answer, followUp, escalate };
  },
});
