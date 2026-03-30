import { assertEquals } from "@std/assert";
import {
  buildAssistantInitFillMessage,
  buildTestTabBlockingMessage,
} from "./testTabValidation.ts";

Deno.test("buildTestTabBlockingMessage prefers scenario selection state", () => {
  assertEquals(
    buildTestTabBlockingMessage({
      hasScenarioSelection: false,
      scenarioJsonErrorCount: 1,
      assistantInitJsonErrorCount: 1,
      missingScenarioFields: ["customer.name"],
      missingAssistantInitFields: ["assistant.prompt"],
    }),
    "Select a scenario deck to run.",
  );
});

Deno.test("buildTestTabBlockingMessage reports invalid JSON before missing fields", () => {
  assertEquals(
    buildTestTabBlockingMessage({
      hasScenarioSelection: true,
      scenarioJsonErrorCount: 1,
      assistantInitJsonErrorCount: 0,
      missingScenarioFields: ["customer.name"],
      missingAssistantInitFields: [],
    }),
    "Fix invalid JSON fields to run.",
  );
});

Deno.test("buildTestTabBlockingMessage reports missing scenario fields", () => {
  assertEquals(
    buildTestTabBlockingMessage({
      hasScenarioSelection: true,
      scenarioJsonErrorCount: 0,
      assistantInitJsonErrorCount: 0,
      missingScenarioFields: ["customer.name", "customer.email"],
      missingAssistantInitFields: ["assistant.prompt"],
    }),
    "Missing required scenario fields: customer.name, customer.email",
  );
});

Deno.test("buildTestTabBlockingMessage reports missing assistant init fields", () => {
  assertEquals(
    buildTestTabBlockingMessage({
      hasScenarioSelection: true,
      scenarioJsonErrorCount: 0,
      assistantInitJsonErrorCount: 0,
      missingScenarioFields: [],
      missingAssistantInitFields: ["assistant.prompt", "assistant.locale"],
    }),
    "Missing required assistant init fields: assistant.prompt, assistant.locale",
  );
});

Deno.test("buildAssistantInitFillMessage uses assistant wording", () => {
  assertEquals(
    buildAssistantInitFillMessage(["assistant.prompt", "assistant.locale"]),
    "Missing required assistant init fields will be requested from the assistant: assistant.prompt, assistant.locale",
  );
});
