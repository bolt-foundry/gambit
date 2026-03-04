import workspaceScenarioRunSendEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceScenarioRunSend/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceScenarioRunSendMutation = defineGambitMutation({
  entrypoint: workspaceScenarioRunSendEntrypoint,
  flightPolicy: "single",
});

export default gambitWorkspaceScenarioRunSendMutation;
