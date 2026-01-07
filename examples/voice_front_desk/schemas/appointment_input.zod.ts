import { z } from "npm:zod@^3.23.8";

export default z.object({
  patientId: z.string().optional(),
  callerName: z.string().optional(),
  dob: z.string().optional(),
  callbackNumber: z.string().optional(),
  originalAppointmentDate: z.string().optional().describe(
    "Known date/time for the appointment being rescheduled",
  ),
  provider: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  lastUserMessage: z.string().optional(),
});
