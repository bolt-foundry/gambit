import { z } from "zod";

const candidateSchema = z.object({
  patientId: z.string(),
  name: z.string(),
  dob: z.string().optional(),
  phone: z.string().optional(),
});

export default z.object({
  status: z.enum(["matched", "ambiguous", "not_found", "needs_more_info"]),
  patientId: z.string().optional().describe("Existing patient identifier."),
  candidates: z
    .array(candidateSchema)
    .optional()
    .describe("Potential matches for disambiguation."),
  missingFields: z
    .array(z.string())
    .optional()
    .describe("Missing details needed to identify the patient."),
  followUpQuestion: z
    .string()
    .optional()
    .describe("Suggested clarifying question for the caller."),
  suggestedAction: z
    .enum(["ask_for_details", "start_new_patient", "leave_callback"])
    .optional()
    .describe("Suggested next step for the root deck."),
  summary: z.string().optional().describe("One sentence identity recap."),
});
