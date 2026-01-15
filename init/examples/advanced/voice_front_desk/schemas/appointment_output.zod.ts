import { z } from "npm:zod";

const candidateSchema = z.object({
  appointmentId: z.string(),
  scheduledFor: z.string(),
  provider: z.string().optional(),
  location: z.string().optional(),
});

export default z.object({
  status: z.enum(["matched", "ambiguous", "not_found", "needs_more_info"]),
  appointmentId: z.string().optional().describe(
    "Appointment identifier to reschedule.",
  ),
  candidates: z
    .array(candidateSchema)
    .optional()
    .describe("Potential matches for disambiguation."),
  missingFields: z
    .array(z.string())
    .optional()
    .describe("Missing details needed to identify the appointment."),
  followUpQuestion: z
    .string()
    .optional()
    .describe("Suggested clarifying question for the caller."),
  suggestedAction: z
    .enum(["ask_for_details", "leave_callback"])
    .optional()
    .describe("Suggested next step for the root deck."),
  summary: z
    .string()
    .optional()
    .describe("One sentence appointment recap."),
});
