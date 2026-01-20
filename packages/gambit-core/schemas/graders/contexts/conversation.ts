import { z } from "zod";

export const graderMessageSchema = z.object({
  role: z.string(),
  content: z.any().optional(),
  name: z.string().optional(),
});

export const graderConversationSchema = z.object({
  messages: z.array(graderMessageSchema).optional(),
  meta: z.record(z.any()).optional(),
  notes: z.object({ text: z.string().optional() }).optional(),
});

export default z.object({
  session: graderConversationSchema,
});
