import { defineDeck } from "jsr:@molt-foundry/gambit";
import { z } from "npm:zod";

const contextSchema = z.object({
  patientId: z.string(),
  appointmentDate: z.string().optional(),
  provider: z.string().optional(),
  location: z.string().optional(),
});

const matchSchema = z.object({
  appointmentId: z.string(),
  scheduledFor: z.string(),
  provider: z.string().optional(),
  location: z.string().optional(),
  type: z.string().optional(),
});

const responseSchema = z.object({
  status: z.enum(["matched", "ambiguous", "not_found"]),
  matches: z.array(matchSchema),
  query: z.object({
    patientId: z.string(),
    appointmentDate: z.string().optional(),
    provider: z.string().optional(),
    location: z.string().optional(),
  }),
  guidance: z.string(),
});

const APPOINTMENTS = [
  {
    appointmentId: "apt-2001",
    patientId: "pt-1002",
    scheduledFor: "2025-03-12T09:15:00-08:00",
    provider: "Dr. Alina Chen",
    location: "Exam 4",
    type: "follow_up",
  },
  {
    appointmentId: "apt-2002",
    patientId: "pt-1002",
    scheduledFor: "2025-04-02T11:00:00-08:00",
    provider: "Dr. Alina Chen",
    location: "Exam 3",
    type: "follow_up",
  },
  {
    appointmentId: "apt-2003",
    patientId: "pt-1001",
    scheduledFor: "2025-03-20T14:30:00-08:00",
    provider: "Dr. Marcos Patel",
    location: "Exam 2",
    type: "physical",
  },
] as const;

const normalize = (value?: string) => value?.trim().toLowerCase() ?? "";

const dateMatches = (scheduledFor: string, queryDate?: string) => {
  if (!queryDate) return true;
  const normalizedQuery = normalize(queryDate);
  return normalize(scheduledFor).includes(normalizedQuery);
};

const fakeEhrFetch = async (query: {
  patientId: string;
  appointmentDate?: string;
  provider?: string;
  location?: string;
}) => {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const provider = normalize(query.provider);
  const location = normalize(query.location);
  const results = APPOINTMENTS.filter((appt) => {
    if (appt.patientId !== query.patientId) return false;
    if (!dateMatches(appt.scheduledFor, query.appointmentDate)) return false;
    if (provider && !normalize(appt.provider).includes(provider)) return false;
    if (location && !normalize(appt.location).includes(location)) return false;
    return true;
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({ appointments: results }),
  };
};

export default defineDeck({
  label: "appointment_lookup",
  contextSchema,
  responseSchema,
  async run(ctx) {
    const query = {
      patientId: ctx.input.patientId.trim(),
      appointmentDate: ctx.input.appointmentDate?.trim(),
      provider: ctx.input.provider?.trim(),
      location: ctx.input.location?.trim(),
    };
    const response = await fakeEhrFetch(query);
    const payload = response.ok ? await response.json() : { appointments: [] };
    const matches = Array.isArray(payload.appointments)
      ? payload.appointments.map((appt) => ({
        appointmentId: String(appt.appointmentId),
        scheduledFor: String(appt.scheduledFor),
        provider: appt.provider ? String(appt.provider) : undefined,
        location: appt.location ? String(appt.location) : undefined,
        type: appt.type ? String(appt.type) : undefined,
      }))
      : [];
    const status = matches.length === 0
      ? "not_found"
      : matches.length === 1
      ? "matched"
      : "ambiguous";
    const guidance = status === "matched"
      ? "Appointment located; proceed with reschedule."
      : status === "ambiguous"
      ? "Multiple appointments found; request additional details."
      : "No appointment found; ask for more details or offer callback.";
    return {
      status,
      matches,
      query,
      guidance,
    };
  },
});
