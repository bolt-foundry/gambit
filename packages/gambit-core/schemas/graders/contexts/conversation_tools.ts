import { z } from "zod";

type GraderToolCall = {
  id?: string;
  type?: string;
  function: {
    name: string;
    arguments?: string;
  };
};

type GraderConversationMessageWithTools = {
  role: string;
  content?: unknown;
  name?: string;
  tool_calls?: Array<GraderToolCall>;
};

type GraderConversationWithTools = {
  messages?: Array<GraderConversationMessageWithTools>;
  meta?: Record<string, unknown>;
  notes?: {
    text?: string;
  };
};

type GraderConversationToolsContext = {
  session: GraderConversationWithTools;
};

const graderToolCallSchema: z.ZodType<GraderToolCall> = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string().optional(),
  }),
});

export const graderConversationMessageWithToolsSchema: z.ZodType<
  GraderConversationMessageWithTools
> = z.object({
  role: z.string(),
  content: z.any().optional(),
  name: z.string().optional(),
  tool_calls: z.array(graderToolCallSchema).optional(),
});

export const graderConversationWithToolsSchema: z.ZodType<
  GraderConversationWithTools
> = z.object({
  messages: z.array(graderConversationMessageWithToolsSchema).optional(),
  meta: z.record(z.any()).optional(),
  notes: z.object({ text: z.string().optional() }).optional(),
});

const graderConversationToolsContextSchema: z.ZodType<
  GraderConversationToolsContext
> = z.object({
  session: graderConversationWithToolsSchema,
});

export default graderConversationToolsContextSchema;
