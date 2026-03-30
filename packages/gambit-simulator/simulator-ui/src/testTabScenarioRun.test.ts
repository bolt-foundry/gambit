import { assertEquals } from "@std/assert";
import {
  buildAssistantChatStartInput,
  buildScenarioRunStartInput,
  canStartAssistantRun,
  canStartScenarioRun,
} from "./testTabScenarioRun.ts";

Deno.test("canStartScenarioRun blocks scenario-side validation failures independently", () => {
  assertEquals(
    canStartScenarioRun({
      workspaceId: "ws-1",
      selectedScenarioDeckId: "scenario-1",
      startRunInFlight: false,
      sendRunInFlight: false,
      scenarioInputSchemaError: null,
      assistantInputSchemaError: null,
      scenarioJsonError: "Invalid JSON",
      assistantInitJsonError: null,
      missingScenarioFields: [],
      missingAssistantInitFields: [],
    }),
    false,
  );
  assertEquals(
    canStartScenarioRun({
      workspaceId: "ws-1",
      selectedScenarioDeckId: "scenario-1",
      startRunInFlight: false,
      sendRunInFlight: false,
      scenarioInputSchemaError: null,
      assistantInputSchemaError: null,
      scenarioJsonError: null,
      assistantInitJsonError: null,
      missingScenarioFields: ["customer.name"],
      missingAssistantInitFields: [],
    }),
    false,
  );
});

Deno.test("canStartScenarioRun blocks assistant-side validation failures independently", () => {
  assertEquals(
    canStartScenarioRun({
      workspaceId: "ws-1",
      selectedScenarioDeckId: "scenario-1",
      startRunInFlight: false,
      sendRunInFlight: false,
      scenarioInputSchemaError: null,
      assistantInputSchemaError: null,
      scenarioJsonError: null,
      assistantInitJsonError: "Invalid JSON",
      missingScenarioFields: [],
      missingAssistantInitFields: [],
    }),
    false,
  );
  assertEquals(
    canStartScenarioRun({
      workspaceId: "ws-1",
      selectedScenarioDeckId: "scenario-1",
      startRunInFlight: false,
      sendRunInFlight: false,
      scenarioInputSchemaError: null,
      assistantInputSchemaError: null,
      scenarioJsonError: null,
      assistantInitJsonError: null,
      missingScenarioFields: [],
      missingAssistantInitFields: ["assistant.prompt"],
    }),
    false,
  );
});

Deno.test("canStartAssistantRun ignores scenario-side validation and selection state", () => {
  assertEquals(
    canStartAssistantRun({
      workspaceId: "ws-1",
      selectedScenarioDeckId: null,
      startRunInFlight: false,
      sendRunInFlight: false,
      scenarioInputSchemaError: "broken scenario schema",
      assistantInputSchemaError: null,
      scenarioJsonError: "Invalid JSON",
      assistantInitJsonError: null,
      missingScenarioFields: ["customer.name"],
      missingAssistantInitFields: [],
    }),
    true,
  );
});

Deno.test("buildScenarioRunStartInput keeps scenario and assistant payloads separate", () => {
  assertEquals(
    buildScenarioRunStartInput({
      workspaceId: "ws-1",
      selectedScenarioDeckId: "scenario-1",
      scenarioJsonText: '{"scenarioToken":"scenario-input"}',
      assistantInitJsonText: '{"assistantToken":"assistant-input"}',
    }),
    {
      workspaceId: "ws-1",
      scenarioDeckId: "scenario-1",
      scenarioInput: '{"scenarioToken":"scenario-input"}',
      assistantInit: '{"assistantToken":"assistant-input"}',
    },
  );
});

Deno.test("buildAssistantChatStartInput only submits assistant init", () => {
  assertEquals(
    buildAssistantChatStartInput({
      workspaceId: "ws-1",
      assistantInitJsonText: '{"assistantToken":"assistant-input"}',
    }),
    {
      workspaceId: "ws-1",
      scenarioDeckId: null,
      scenarioInput: null,
      assistantInit: '{"assistantToken":"assistant-input"}',
    },
  );
});
