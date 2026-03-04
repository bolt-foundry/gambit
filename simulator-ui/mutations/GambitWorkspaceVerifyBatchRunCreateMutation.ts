import workspaceVerifyBatchRunCreateEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceVerifyBatchRunCreate/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceVerifyBatchRunCreateMutation = defineGambitMutation(
  {
    entrypoint: workspaceVerifyBatchRunCreateEntrypoint,
    flightPolicy: "single",
  },
);

export default gambitWorkspaceVerifyBatchRunCreateMutation;
