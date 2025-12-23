import { defineDeck } from "../../../mod.ts";
import { z } from "zod";

const inputSchema = z.object({
  clinicId: z.string().optional(),
  firstName: z.string(),
  lastName: z.string(),
  dob: z.string().optional(),
});

const outputSchema = z.object({
  status: z.enum(["success", "not_found"]),
  patientId: z.string().optional(),
  normalizedName: z.string(),
  guidance: z.string(),
});

export default defineDeck({
  label: "patient_lookup",
  inputSchema,
  outputSchema,
  run(ctx) {
    const normalizedName =
      `${ctx.input.firstName.trim()} ${ctx.input.lastName.trim()}`
        .trim();
    const success = ctx.input.lastName.toLowerCase() !== "unknown";
    const patientId = success
      ? `pt-${ctx.input.lastName.toLowerCase()}-${ctx.input.dob ?? "pending"}`
      : undefined;

    return {
      status: success ? "success" : "not_found",
      patientId,
      normalizedName,
      guidance: success
        ? "Chart located; verify contact info before proceeding."
        : "No chart found. Capture new patient details before continuing.",
    };
  },
});
