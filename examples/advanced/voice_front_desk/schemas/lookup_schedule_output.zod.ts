import { z } from "npm:zod@^3.23.8";

const slotSchema = z.object({
  isoStart: z.string().describe("ISO datetime for the slot"),
  display: z.string().describe("Human friendly summary"),
  provider: z.string(),
  location: z.string(),
  type: z.string(),
});

export default z.object({
  provider: z.string().describe("Provider whose schedule was searched"),
  slots: z.array(slotSchema).describe("Available appointment options"),
  waitlistOffered: z
    .boolean()
    .describe("Whether the caller can be added to a waitlist"),
  result: z
    .enum(["scheduled", "reschedule_pending", "no_slots", "waitlisted"])
    .describe("High-level outcome of the scheduling attempt"),
  confirmation: z
    .string()
    .describe("Plain language confirmation or next-step summary"),
  message: z.string().describe(
    "Additional note about availability or follow-up",
  ),
});
