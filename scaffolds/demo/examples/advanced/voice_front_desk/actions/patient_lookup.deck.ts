import { defineDeck } from "jsr:@molt-foundry/gambit";
import { z } from "npm:zod";

const contextSchema = z.object({
  clinicId: z.string().optional(),
  firstName: z.string(),
  lastName: z.string(),
  dob: z.string().optional(),
  callbackNumber: z.string().optional(),
});

const matchSchema = z.object({
  patientId: z.string(),
  name: z.string(),
  dob: z.string(),
  phone: z.string().optional(),
});

const responseSchema = z.object({
  status: z.enum(["matched", "ambiguous", "not_found"]),
  matches: z.array(matchSchema),
  query: z.object({
    firstName: z.string(),
    lastName: z.string(),
    dob: z.string().optional(),
    callbackNumber: z.string().optional(),
  }),
  guidance: z.string(),
});

const PATIENTS = [
  {
    patientId: "pt-1001",
    firstName: "Avery",
    lastName: "Nguyen",
    dob: "1986-04-12",
    phone: "555-0101",
  },
  {
    patientId: "pt-1002",
    firstName: "Jordan",
    lastName: "Lee",
    dob: "1992-11-03",
    phone: "555-0122",
  },
  {
    patientId: "pt-1003",
    firstName: "Jordan",
    lastName: "Lee",
    dob: "1991-07-28",
    phone: "555-0149",
  },
  {
    patientId: "pt-1004",
    firstName: "Priya",
    lastName: "Shah",
    dob: "1979-02-18",
    phone: "555-0188",
  },
] as const;

const normalize = (value: string) => value.trim().toLowerCase();

const normalizePhone = (value?: string) => {
  if (!value) return "";
  return value.replace(/[^0-9]/g, "");
};

const fakeEhrFetch = async (query: {
  firstName: string;
  lastName: string;
  dob?: string;
  callbackNumber?: string;
}) => {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const firstName = normalize(query.firstName);
  const lastName = normalize(query.lastName);
  const dob = query.dob?.trim();
  const phone = normalizePhone(query.callbackNumber);
  const results = PATIENTS.filter((patient) => {
    if (normalize(patient.firstName) !== firstName) return false;
    if (normalize(patient.lastName) !== lastName) return false;
    if (dob && patient.dob !== dob) return false;
    if (phone && normalizePhone(patient.phone) !== phone) return false;
    return true;
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({ patients: results }),
  };
};

export default defineDeck({
  label: "patient_lookup",
  contextSchema,
  responseSchema,
  async run(ctx) {
    const query = {
      firstName: ctx.input.firstName.trim(),
      lastName: ctx.input.lastName.trim(),
      dob: ctx.input.dob?.trim(),
      callbackNumber: ctx.input.callbackNumber?.trim(),
    };
    const response = await fakeEhrFetch(query);
    const payload = response.ok ? await response.json() : { patients: [] };
    const matches = Array.isArray(payload.patients)
      ? payload.patients.map((patient) => ({
        patientId: String(patient.patientId),
        name: `${patient.firstName} ${patient.lastName}`.trim(),
        dob: String(patient.dob),
        phone: patient.phone ? String(patient.phone) : undefined,
      }))
      : [];
    const status = matches.length === 0
      ? "not_found"
      : matches.length === 1
      ? "matched"
      : "ambiguous";
    const guidance = status === "matched"
      ? "Chart located; confirm contact details."
      : status === "ambiguous"
      ? "Multiple charts found; request additional details."
      : "No chart found; consider starting a new patient intake.";
    return {
      status,
      matches,
      query,
      guidance,
    };
  },
});
