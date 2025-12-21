import { defineDeck } from "../../mod.ts";
import patchProposalSchema from "./schemas/patchProposal.zod.ts";

export default defineDeck({
  label: "editor_assistant.propose_patch",
  inputSchema: patchProposalSchema,
  outputSchema: patchProposalSchema,
  run(ctx) {
    // Validate and echo the proposed patch back to the parent deck.
    return patchProposalSchema.parse(ctx.input);
  },
});
