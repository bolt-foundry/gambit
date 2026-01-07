import { z } from "npm:zod@^3.23.8";

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
  clinicName: z.string().describe("The clinic or organization name").default(
    "Bolt Foundry Clinic",
  ),
  initialGreeting: z.string().describe(
    "First line the assistant should use when answering",
  ).default(
    "Hi and thanks for calling the Bolt Foundry Clinic. You've reached our after hours line, and I'm an AI assistant. How can I help you today?",
  ),
});
