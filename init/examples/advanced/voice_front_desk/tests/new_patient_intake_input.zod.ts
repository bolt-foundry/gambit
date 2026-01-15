import { z } from "npm:zod";

export default z.object({
  scenarioDescription: z.string().describe(
    "Optional instructions that describe the new patient intake scenario",
  ).optional(),
  callerName: z.string().describe("Caller name to use if asked.").optional()
    .default(""),
  dob: z.string().describe("Date of birth to share if asked.").optional()
    .default(""),
  callbackNumber: z.string().describe("Callback number to share if asked.")
    .optional()
    .default("(646) 555-0198"),
  insuranceStatus: z.string()
    .describe("Insurance status or plan details to share if asked.")
    .optional()
    .default("Blue Cross PPO"),
  reason: z.string().describe("Primary reason for the call if asked.")
    .optional()
    .default("New patient visit"),
  preferredDays: z.array(z.string()).describe(
    "Preferred days of the week or dates if asked.",
  ).optional().default(["Monday", "Thursday"]),
  preferredTimes: z.array(z.string()).describe(
    "Preferred times of day if asked.",
  ).optional().default(["morning"]),
});
