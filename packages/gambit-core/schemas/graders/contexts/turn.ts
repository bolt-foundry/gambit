import { z } from "zod";
import {
  graderConversationSchema,
  graderMessageSchema,
} from "./conversation.ts";

type GraderTurnContext = {
  session: z.infer<typeof graderConversationSchema>;
  messageToGrade: z.infer<typeof graderMessageSchema>;
};

const graderTurnContextSchema: z.ZodType<GraderTurnContext> = z.object({
  session: graderConversationSchema,
  messageToGrade: graderMessageSchema,
});

export default graderTurnContextSchema;
