import { z } from "zod";

const plainChatInputOptionalSchema: z.ZodType<string | undefined> = z.string()
  .optional();

export default plainChatInputOptionalSchema;
