import { z } from "npm:zod@^3.23.8";

const slotSchema = z.object({
  isoStart: z.string(),
  display: z.string(),
  provider: z.string().optional(),
  location: z.string().optional(),
  type: z.string().optional(),
});

export default z.object({
  status: z.enum([
    "needs_more_info",
    "options_ready",
    "no_slots",
    "waitlisted",
    "confirmed",
  ]),
  provider: z.string().optional(),
  slots: z.array(slotSchema).optional(),
  confirmedSlot: slotSchema.optional(),
  confirmationId: z.string().optional(),
  waitlistOffered: z.boolean().optional(),
  missingFields: z.array(z.string()).optional(),
  followUpQuestion: z.string().optional(),
  summary: z.string().optional(),
});
