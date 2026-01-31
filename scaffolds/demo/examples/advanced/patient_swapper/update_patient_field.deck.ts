import { defineDeck } from "jsr:@molt-foundry/gambit";
import { z } from "npm:zod";

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export default defineDeck({
  label: "update_patient_field",
  contextSchema: z.object({
    patientId: z.string(),
    updateField: z.string(),
    updateValue: z.string(),
  }),
  responseSchema: z.object({
    updated: z.boolean().describe("Whether the update was applied"),
    sql: z.string().describe("SQL used to update the patient"),
  }),
  run(ctx) {
    const sql = `UPDATE patients SET ${ctx.input.updateField} = '${
      escapeSql(ctx.input.updateValue)
    }' WHERE patient_id = '${escapeSql(ctx.input.patientId)}';`;

    ctx.log({
      level: "info",
      message: "Mocked SQL update for patient",
      meta: { sql },
    });

    return { updated: true, sql };
  },
});
