import { z } from "zod";

type GraderToolCall = {
  id?: string;
  type?: string;
  function: {
    name: string;
    arguments?: string;
  };
};

type GraderMessageWithTools = {
  role: string;
  content?: unknown;
  name?: string;
  tool_calls?: Array<GraderToolCall>;
};

type GraderConversationWithTools = {
  messages?: Array<GraderMessageWithTools>;
  meta?: Record<string, unknown>;
  notes?: {
    text?: string;
  };
};

type GraderTurnToolsContext = {
  session: GraderConversationWithTools;
  messageToGrade: GraderMessageWithTools;
};

const graderToolCallSchema: z.ZodType<GraderToolCall> = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string().optional(),
  }),
});

export const graderMessageWithToolsSchema: z.ZodType<GraderMessageWithTools> = z
  .object({
    role: z.string(),
    content: z.any().optional(),
    name: z.string().optional(),
    tool_calls: z.array(graderToolCallSchema).optional(),
  });

export const graderConversationWithToolsSchema: z.ZodType<
  GraderConversationWithTools
> = z.object({
  messages: z.array(graderMessageWithToolsSchema).optional(),
  meta: z.record(z.any()).optional(),
  notes: z.object({ text: z.string().optional() }).optional(),
});

const graderTurnToolsContextSchema: z.ZodType<GraderTurnToolsContext> = z
  .object({
    session: graderConversationWithToolsSchema,
    messageToGrade: graderMessageWithToolsSchema,
  });

export default graderTurnToolsContextSchema;
