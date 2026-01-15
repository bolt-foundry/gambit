import { z } from "npm:zod";

export default z.object({
  ticketId: z.string(),
  queuedAt: z.string().describe("ISO timestamp for logging"),
  audience: z.string(),
  priority: z.string(),
  status: z.enum(["queued", "delivered"]).default("queued"),
});
