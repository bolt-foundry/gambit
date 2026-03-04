import workspaceGradeFlagToggleEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceGradeFlagToggle/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceGradeFlagToggleMutation = defineGambitMutation({
  entrypoint: workspaceGradeFlagToggleEntrypoint,
  flightPolicy: "single",
});

export default gambitWorkspaceGradeFlagToggleMutation;
