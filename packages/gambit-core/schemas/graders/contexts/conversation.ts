import { z } from "zod";

type GraderMessage = {
  role: string;
  content?: unknown;
  name?: string;
};

type GraderConversation = {
  messages?: Array<GraderMessage>;
  meta?: Record<string, unknown>;
  notes?: {
    text?: string;
  };
};

type GraderConversationContext = {
  session: GraderConversation;
};

export const graderMessageSchema: z.ZodType<GraderMessage> = z.object({
  role: z.string(),
  content: z.any().optional(),
  name: z.string().optional(),
});

export const graderConversationSchema: z.ZodType<GraderConversation> = z.object(
  {
    messages: z.array(graderMessageSchema).optional(),
    meta: z.record(z.any()).optional(),
    notes: z.object({ text: z.string().optional() }).optional(),
  },
);

const graderConversationContextSchema: z.ZodType<GraderConversationContext> = z
  .object({
    session: graderConversationSchema,
  });

export default graderConversationContextSchema;
