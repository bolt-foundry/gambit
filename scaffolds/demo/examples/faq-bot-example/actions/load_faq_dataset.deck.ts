import { defineDeck } from "jsr:@molt-foundry/gambit";
import { z } from "npm:zod";

const contextSchema = z.object({});
const responseSchema = z.string();

const faqPath = new URL(import.meta.resolve("../faq_dataset.md"));

export default defineDeck({
  label: "load_faq_dataset",
  contextSchema,
  responseSchema,
  async run() {
    const faqText = await Deno.readTextFile(faqPath);
    return faqText.trim();
  },
});
