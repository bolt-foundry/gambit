import { z } from "zod";

export default z.object({
  scenario: z.string().min(1).default(
    "QA run: mix in-scope FAQ questions (pricing, trial, exports) and out-of-scope requests (HIPAA, SOC 2, data residency).",
  ).describe(
    "Scenario or coverage focus for the policy support bot QA run.",
  ),
}).passthrough().describe("Policy support bot test-bot input");
