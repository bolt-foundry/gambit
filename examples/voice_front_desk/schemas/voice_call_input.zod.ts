import { z } from "zod";

const todayIso = new Date().toISOString().slice(0, 10);

export default z.object({
  callOriginNumber: z.string().optional().describe(
    "Number where the inbound call was received",
  ),
  callerNumber: z.string().optional().describe(
    "Number the caller wants callbacks on",
  ),
  currentDate: z.string().describe(
    "ISO date for 'today' so the assistant can reference it in speech",
  ).default(todayIso),
});
