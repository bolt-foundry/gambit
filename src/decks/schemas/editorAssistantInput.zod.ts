import { z } from "zod";

const editorAssistantInputSchema = z.object({
  idk: z.string().optional(),
});

export type EditorAssistantInput = z.infer<typeof editorAssistantInputSchema>;

export default editorAssistantInputSchema;
