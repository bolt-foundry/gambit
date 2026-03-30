import simulatorResetWorkspaceEntrypoint from "@iso-gambit-sim/Mutation/GambitSimulatorResetWorkspace/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitSimulatorResetWorkspaceMutation = defineGambitMutation({
  entrypoint: simulatorResetWorkspaceEntrypoint,
  flightPolicy: "single",
});

export default gambitSimulatorResetWorkspaceMutation;
