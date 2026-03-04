import workspaceGradeFlagReasonUpdateEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceGradeFlagReasonUpdate/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceGradeFlagReasonUpdateMutation =
  defineGambitMutation({
    entrypoint: workspaceGradeFlagReasonUpdateEntrypoint,
    flightPolicy: "single",
  });

export default gambitWorkspaceGradeFlagReasonUpdateMutation;
