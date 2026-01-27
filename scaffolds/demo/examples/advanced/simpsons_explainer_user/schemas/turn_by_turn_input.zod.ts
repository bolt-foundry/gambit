import { z } from "npm:zod";

const messageSchema = z.object({
  role: z.string(),
  content: z.any().optional(),
  name: z.string().optional(),
});

const sessionSchema = z.object({
  messages: z.array(messageSchema).optional(),
  meta: z.record(z.any()).optional(),
  notes: z.object({ text: z.string().optional() }).optional(),
});

export default z.object({
  session: sessionSchema,
  messageToGrade: messageSchema,
});
