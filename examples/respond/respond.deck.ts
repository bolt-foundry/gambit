import { defineDeck } from "../../mod.ts";
import { z } from "zod";

export default defineDeck({
  inputSchema: z.string().optional(),
  outputSchema: z.string(),
  modelParams: { model: "openai/gpt-4o-mini", temperature: 0 },
  syntheticTools: { respond: true },
  body: `
You must immediately finish by calling the \`gambit_respond\` tool.
- Do not write any normal assistant text.
- Call \`gambit_respond\` once with: { "payload": "ok" }.
  `.trim(),
});
