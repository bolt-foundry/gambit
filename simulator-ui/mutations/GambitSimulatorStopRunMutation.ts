import simulatorStopRunEntrypoint from "@iso-gambit-sim/Mutation/GambitSimulatorStopRun/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitSimulatorStopRunMutation = defineGambitMutation({
  entrypoint: simulatorStopRunEntrypoint,
  flightPolicy: "single",
});

export default gambitSimulatorStopRunMutation;
