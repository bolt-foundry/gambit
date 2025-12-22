import { z } from "zod";

export const lookupSchema = z
  .object({
    patientId: z.string().optional(),
    name: z.string().optional(),
    dob: z.string().optional(),
    email: z.string().optional(),
  })
  .passthrough();

const patientSwapperInputSchema = z.object({
  schema: z.string().describe("Database schema provided at runtime"),
  lookup: lookupSchema.describe("Lookup criteria for the patient"),
  updateField: z.string().describe("Column name to update"),
  updateValue: z.string().describe("New value to set"),
  callingContext: z.string().optional().describe("Extra context for the run"),
});

export default patientSwapperInputSchema;
