import workspaceBuildRunCreateEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceBuildRunCreate/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceBuildRunCreateMutation = defineGambitMutation({
  entrypoint: workspaceBuildRunCreateEntrypoint,
  flightPolicy: "single",
});

export default gambitWorkspaceBuildRunCreateMutation;
