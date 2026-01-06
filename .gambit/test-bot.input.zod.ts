import { z } from "zod";

export default z.object({
  scenario: z.string().min(1).default(
    "Happy-path QA scenario: user chats through a simple request and the assistant responds clearly.",
  ).describe(
    "Scenario the QA bot should run (goal, user intent, constraints, or edge cases to probe).",
  ),
}).passthrough().describe("Test Bot scenario input");
