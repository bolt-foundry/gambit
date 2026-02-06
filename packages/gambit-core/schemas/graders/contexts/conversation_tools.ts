import { z } from "zod";

const graderToolCallSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string().optional(),
  }),
});

export const graderConversationMessageWithToolsSchema = z.object({
  role: z.string(),
  content: z.any().optional(),
  name: z.string().optional(),
  tool_calls: z.array(graderToolCallSchema).optional(),
});

export const graderConversationWithToolsSchema = z.object({
  messages: z.array(graderConversationMessageWithToolsSchema).optional(),
  meta: z.record(z.any()).optional(),
  notes: z.object({ text: z.string().optional() }).optional(),
});

export default z.object({
  session: graderConversationWithToolsSchema,
});
