import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

const contactSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
});

const insuranceSchema = z.object({
  carrier: z.string(),
  memberId: z.string(),
  holder: z.string().optional(),
}).optional();

const contextSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  dob: z.string(),
  contact: contactSchema,
  insurance: insuranceSchema,
});

const responseSchema = z.object({
  patientId: z.string(),
  insuranceStatus: z.enum(["captured", "missing"]),
});

export default defineDeck({
  label: "acquire_new_patient",
  contextSchema,
  responseSchema,
  run(ctx) {
    const patientId = `pt-new-${Date.now().toString(36)}`;
    const insuranceStatus = ctx.input.insurance ? "captured" : "missing";

    return { patientId, insuranceStatus };
  },
});
