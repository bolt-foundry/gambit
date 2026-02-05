import { z } from "npm:zod";

export default z.object({
  deckPath: z.string().describe("Path to the deck being reviewed."),
  deckContents: z.string().describe("Current contents of the deck."),
  guidePath: z.string().describe("Path to the local review guide."),
  guideContents: z.string().describe("Review guide content to follow."),
  goal: z.string().describe("Optional review goal provided by the caller.")
    .optional(),
});
