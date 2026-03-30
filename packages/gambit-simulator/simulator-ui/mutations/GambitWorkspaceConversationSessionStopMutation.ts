import workspaceConversationSessionStopEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceConversationSessionStop/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceConversationSessionStopMutation =
  defineGambitMutation({
    entrypoint: workspaceConversationSessionStopEntrypoint,
    flightPolicy: "single",
  });

export default gambitWorkspaceConversationSessionStopMutation;
