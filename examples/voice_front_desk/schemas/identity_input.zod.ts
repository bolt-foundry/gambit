import { z } from "zod";

export default z.object({
  callerNumber: z.string().optional(),
  callOriginNumber: z.string().optional(),
  notes: z.string().optional(),
  lastUserMessage: z.string().optional(),
  name: z
    .object({
      first: z.string().optional(),
      last: z.string().optional(),
    })
    .optional(),
  dateOfBirth: z.string().optional(),
  callbackNumber: z.string().optional(),
});
