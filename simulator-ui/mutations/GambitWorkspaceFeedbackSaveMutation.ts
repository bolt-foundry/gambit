import workspaceFeedbackSaveEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceFeedbackSave/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceFeedbackSaveMutation = defineGambitMutation({
  entrypoint: workspaceFeedbackSaveEntrypoint,
  flightPolicy: "single",
});

export default gambitWorkspaceFeedbackSaveMutation;
