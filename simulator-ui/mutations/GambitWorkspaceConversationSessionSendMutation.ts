import workspaceConversationSessionSendEntrypoint from "@iso-gambit-sim/Mutation/GambitWorkspaceConversationSessionSend/entrypoint.ts";
import { defineGambitMutation } from "../src/hooks/defineGambitMutation.ts";

export const gambitWorkspaceConversationSessionSendMutation =
  defineGambitMutation({
    entrypoint: workspaceConversationSessionSendEntrypoint,
    flightPolicy: "single",
  });

export default gambitWorkspaceConversationSessionSendMutation;
