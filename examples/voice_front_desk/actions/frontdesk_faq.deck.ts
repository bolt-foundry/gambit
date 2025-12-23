import { defineDeck } from "../../../mod.ts";
import { z } from "zod";

const inputSchema = z.object({
  clinicId: z.string().optional(),
  question: z.string(),
});

const outputSchema = z.object({
  answer: z.string(),
  followUp: z.string(),
});

const faqSnippets: Array<{ match: RegExp; answer: string; followUp: string }> =
  [
    {
      match: /hours|open/i,
      answer:
        "We see patients Monday through Thursday eight to six, Friday until four, and Saturdays for urgent visits nine to one.",
      followUp: "Would you like me to help with a visit during those hours?",
    },
    {
      match: /location|address/i,
      answer:
        "We're at 2147 Winding Creek Road, Suite 300, in San Mateo with garage parking on site.",
      followUp: "Should I text those directions to the number on file?",
    },
    {
      match: /cost|price/i,
      answer:
        "Most visits bill to insurance; self-pay new visits start at $185 and include follow-up messaging.",
      followUp: "Do you want to check insurance eligibility or schedule now?",
    },
  ];

export default defineDeck({
  label: "frontdesk_faq",
  inputSchema,
  outputSchema,
  run(ctx) {
    const found = faqSnippets.find((entry) =>
      entry.match.test(ctx.input.question)
    );
    if (found) {
      return { answer: found.answer, followUp: found.followUp };
    }
    return {
      answer: "Let me double-check that policy for you and follow up shortly.",
      followUp: "Can I take a message for the care team?",
    };
  },
});
