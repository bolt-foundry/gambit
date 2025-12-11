import { defineDeck } from "../mod.ts";
import { z } from "zod";

export default defineDeck({
  label: "schema_form_demo",
  inputSchema: z.object({
    trainerName: z.string().describe("Trainer name").default("Ash Ketchum"),
  }),
  modelParams: { model: "openai/gpt-4o-mini", temperature: 0.4 },
  body: `
You are a Pokémon advice line.
The caller is trainer: "{{input.trainerName}}".

Guidelines:
- Greet the trainer by name once.
- Ask briefly what they are facing if they haven’t said yet.
- When they describe a scenario, suggest 1–2 Pokémon (or types) with a one-line reason.
- Keep replies concise.
`,
});
