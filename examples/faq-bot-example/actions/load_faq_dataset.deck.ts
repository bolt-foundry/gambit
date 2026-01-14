import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod@^3.23.8";

const inputSchema = z.object({});
const outputSchema = z.string();

const faqPath = new URL(import.meta.resolve("../faq_dataset.md"));

export default defineDeck({
  label: "load_faq_dataset",
  inputSchema,
  outputSchema,
  async run() {
    const faqText = await Deno.readTextFile(faqPath);
    return faqText.trim();
  },
});
