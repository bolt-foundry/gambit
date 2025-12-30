import { z } from "zod";

const patientContextSchema = z.object({
  callerName: z.string().optional(),
  patientId: z.string().optional(),
  dob: z.string().optional(),
  callbackNumber: z.string().optional(),
  insuranceStatus: z.string().optional(),
});

export default z.object({
  patientContext: patientContextSchema.optional(),
  reason: z
    .string()
    .optional()
    .describe("Summary of why the caller needs the visit"),
  visitType: z
    .enum(["reschedule", "book_existing", "book_new"])
    .optional()
    .describe("Scheduling branch when known"),
  selectedSlotIso: z.string().optional().describe(
    "ISO start time for a caller-selected slot",
  ),
  preferredDays: z.array(z.string()).optional().describe(
    "Preferred days of the week or dates",
  ),
  preferredTimes: z.array(z.string()).optional().describe(
    "Preferred times of day or ranges",
  ),
  provider: z.string().optional().describe("Preferred clinician"),
  location: z.string().optional().describe("Preferred location"),
  urgency: z.enum(["urgent", "soon", "routine"]).optional(),
  currentAppointment: z
    .object({
      appointmentId: z.string(),
      scheduledFor: z.string().optional(),
      provider: z.string().optional(),
      location: z.string().optional(),
    })
    .optional()
    .describe("Appointment to change if rescheduling"),
  notes: z.string().optional(),
});
