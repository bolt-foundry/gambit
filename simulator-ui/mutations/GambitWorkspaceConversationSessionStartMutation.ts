import workspaceConversationSessionStartEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceConversationSessionStart/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceConversationSessionStartMutation =
  defineGambitMutation({
    entrypoint: workspaceConversationSessionStartEntrypoint,
    flightPolicy: "single",
  });

export default gambitWorkspaceConversationSessionStartMutation;
