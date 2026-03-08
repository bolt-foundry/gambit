import workspaceDeleteEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceDelete/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceDeleteMutation = defineGambitMutation({
  entrypoint: workspaceDeleteEntrypoint,
  flightPolicy: "multi",
});

export default gambitWorkspaceDeleteMutation;
