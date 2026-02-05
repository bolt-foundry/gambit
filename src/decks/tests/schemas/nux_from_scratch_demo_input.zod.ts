import { z } from "npm:zod";

export default z.object({
  scenario: z.string().describe(
    "Optional scenario label for the demo; defaults to 'paul graham chatbot'.",
  ).default("paul graham chatbot"),
});
