import workspaceCreateEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceCreate/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceCreateMutation = defineGambitMutation({
  entrypoint: workspaceCreateEntrypoint,
  flightPolicy: "single",
});

export default gambitWorkspaceCreateMutation;
