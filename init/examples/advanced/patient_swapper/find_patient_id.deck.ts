import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";
import { lookupSchema } from "./schemas/patient_swapper_input.zod.ts";

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export default defineDeck({
  label: "find_patient_id",
  inputSchema: z.object({
    schema: z.string(),
    lookup: lookupSchema,
  }),
  outputSchema: z.object({
    patientId: z.string().describe("Resolved patient identifier"),
    sql: z.string().describe("SQL used to locate the patient"),
  }),
  run(ctx) {
    const entries = Object.entries(ctx.input.lookup).filter(([, value]) =>
      value !== undefined && value !== null && String(value).trim() !== ""
    );
    const whereClause = entries.length
      ? entries
        .map(([key, value]) => `${key} = '${escapeSql(String(value))}'`)
        .join(" AND ")
      : "1 = 1";
    const sql = `SELECT patient_id FROM patients WHERE ${whereClause} LIMIT 1;`;

    const seed = ctx.input.lookup.patientId ??
      ctx.input.lookup.email ??
      ctx.input.lookup.name ??
      ctx.input.lookup.dob ??
      "unknown";
    const normalized = String(seed)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 12);
    const patientId = ctx.input.lookup.patientId ??
      `patient_${normalized || "unknown"}`;

    ctx.log({
      level: "info",
      message: "Mocked SQL lookup for patient",
      meta: { schemaPreview: ctx.input.schema.slice(0, 120), sql },
    });

    return { patientId, sql };
  },
});
