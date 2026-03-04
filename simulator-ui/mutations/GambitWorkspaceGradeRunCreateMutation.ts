import workspaceGradeRunCreateEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceGradeRunCreate/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceGradeRunCreateMutation = defineGambitMutation({
  entrypoint: workspaceGradeRunCreateEntrypoint,
  flightPolicy: "single",
});

export default gambitWorkspaceGradeRunCreateMutation;
