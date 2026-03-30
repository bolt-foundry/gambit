import workspaceScenarioRunStartEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceScenarioRunStart/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceScenarioRunStartMutation = defineGambitMutation({
  entrypoint: workspaceScenarioRunStartEntrypoint,
  flightPolicy: "single",
});

export default gambitWorkspaceScenarioRunStartMutation;
