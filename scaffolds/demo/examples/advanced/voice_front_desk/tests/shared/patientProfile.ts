import { z } from "npm:zod";

type PatientProfileDefaults = {
  firstName: string;
  lastName: string;
  dob: string;
  phone?: string;
  payerName?: string;
  memberId?: string;
  medicationName?: string;
  medicationDose?: string;
  pharmacyName?: string;
  originalAppointmentDate?: string;
};

export function createPatientProfileSchema(
  defaults: PatientProfileDefaults,
) {
  return z.object({
    firstName: z.string().default(defaults.firstName),
    lastName: z.string().default(defaults.lastName),
    dob: z.string().default(defaults.dob),
    phone: z.string().optional().default(defaults.phone ?? ""),
    payerName: z.string().optional().default(defaults.payerName ?? ""),
    memberId: z.string().optional().default(defaults.memberId ?? ""),
    medicationName: z.string().optional().default(
      defaults.medicationName ?? "",
    ),
    medicationDose: z.string().optional().default(
      defaults.medicationDose ?? "",
    ),
    pharmacyName: z.string().optional().default(defaults.pharmacyName ?? ""),
    originalAppointmentDate: z.string().optional().default(
      defaults.originalAppointmentDate ?? "",
    ),
    scenarioDescription: z.string().describe(
      "Optional instructions describing scenario variations",
    ).optional(),
  });
}
