import { z } from "zod";

export const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

const editorAssistantInputSchema = z.object({
  filePath: z.string().min(1).describe("Absolute path of the open file"),
  content: z.string().describe("Current in-memory buffer content"),
  messages: z.array(assistantMessageSchema).describe("Chat transcript so far"),
});

export type EditorAssistantMessage = z.infer<typeof assistantMessageSchema>;
export type EditorAssistantInput = z.infer<typeof editorAssistantInputSchema>;

export default editorAssistantInputSchema;
