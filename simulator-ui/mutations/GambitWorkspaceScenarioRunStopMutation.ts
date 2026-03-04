import workspaceScenarioRunStopEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceScenarioRunStop/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceScenarioRunStopMutation = defineGambitMutation({
  entrypoint: workspaceScenarioRunStopEntrypoint,
  flightPolicy: "single",
});

export default gambitWorkspaceScenarioRunStopMutation;
