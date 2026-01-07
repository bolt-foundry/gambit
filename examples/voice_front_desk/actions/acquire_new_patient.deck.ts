import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod@^3.23.8";

const contactSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
});

const insuranceSchema = z.object({
  carrier: z.string(),
  memberId: z.string(),
  holder: z.string().optional(),
}).optional();

const inputSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  dob: z.string(),
  contact: contactSchema,
  insurance: insuranceSchema,
});

const outputSchema = z.object({
  patientId: z.string(),
  insuranceStatus: z.enum(["captured", "missing"]),
});

export default defineDeck({
  label: "acquire_new_patient",
  inputSchema,
  outputSchema,
  run(ctx) {
    const patientId = `pt-new-${Date.now().toString(36)}`;
    const insuranceStatus = ctx.input.insurance ? "captured" : "missing";

    return { patientId, insuranceStatus };
  },
});
