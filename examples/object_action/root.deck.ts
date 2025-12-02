import { defineDeck } from "../../mod.ts";
import { z } from "zod";

export default defineDeck({
  body: [
    "You help product teams look up structured teammate data.",
    'Whenever you receive a teammate name, call the `fetch_profile` action with {"name": <person>} to retrieve a JSON object.',
    "Use the returned object's fields to craft the final answer and mention at least one project and the person's title.",
  ].join(" "),
  inputSchema: z.string(),
  outputSchema: z.string(),
  modelParams: { model: "openai/gpt-4o-mini" },
  actions: [
    {
      name: "fetch_profile",
      path: "./fetch_profile.deck.ts",
      description:
        "Return an object containing a teammate's title, projects, and experience.",
      label: "fetch_profile",
    },
  ],
});
