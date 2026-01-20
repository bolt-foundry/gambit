import { z } from "zod";
import {
  graderConversationSchema,
  graderMessageSchema,
} from "./conversation.ts";

export default z.object({
  session: graderConversationSchema,
  messageToGrade: graderMessageSchema,
});
