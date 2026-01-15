import { z } from "npm:zod@^3.23.8";

const preferredWindowSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  timeOfDay: z.enum(["morning", "midday", "afternoon", "evening", "any"])
    .optional(),
});

export default z.object({
  operation: z
    .enum(["reschedule", "book_existing", "book_new"])
    .describe("Scheduling branch selected by the behavior card"),
  patientId: z.string().optional(),
  patientName: z.string().optional(),
  reason: z.string().describe(
    "Short summary of why the caller needs the visit",
  ),
  urgency: z
    .enum(["urgent", "soon", "routine"])
    .default("routine")
    .describe("How fast the appointment is needed"),
  provider: z.string().optional(),
  location: z.string().optional(),
  preferredWindow: preferredWindowSchema.optional(),
  currentAppointment: z
    .object({
      appointmentId: z.string(),
      scheduledFor: z.string(),
      location: z.string().optional(),
    })
    .optional()
    .describe("Appointment to change if rescheduling"),
  clinicId: z.string().optional(),
});
