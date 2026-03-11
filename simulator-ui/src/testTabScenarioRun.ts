export type TestTabScenarioRunState = {
  workspaceId: string;
  selectedScenarioDeckId: string | null;
  startRunInFlight: boolean;
  sendRunInFlight: boolean;
  scenarioInputSchemaError?: string | null;
  assistantInputSchemaError?: string | null;
  scenarioJsonError?: string | null;
  assistantInitJsonError?: string | null;
  missingScenarioFields: Array<string>;
  missingAssistantInitFields: Array<string>;
};

export type ScenarioRunStartInput = {
  workspaceId: string;
  scenarioDeckId: string;
  scenarioInput: string | null;
  assistantInit: string | null;
};

export type AssistantChatStartInput = {
  workspaceId: string;
  scenarioDeckId: null;
  scenarioInput: null;
  assistantInit: string | null;
};

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function toOptionalJsonText(text: string): string | null {
  return hasText(text) ? text : null;
}

export function canStartScenarioRun(state: TestTabScenarioRunState): boolean {
  if (!hasText(state.workspaceId)) return false;
  if (!hasText(state.selectedScenarioDeckId)) return false;
  if (state.startRunInFlight) return false;
  if (state.scenarioInputSchemaError) return false;
  if (state.assistantInputSchemaError) return false;
  if (state.scenarioJsonError) return false;
  if (state.assistantInitJsonError) return false;
  if (state.missingScenarioFields.length > 0) return false;
  if (state.missingAssistantInitFields.length > 0) return false;
  return true;
}

export function canStartAssistantRun(state: TestTabScenarioRunState): boolean {
  if (!hasText(state.workspaceId)) return false;
  if (state.startRunInFlight) return false;
  if (state.sendRunInFlight) return false;
  if (state.assistantInputSchemaError) return false;
  if (state.assistantInitJsonError) return false;
  if (state.missingAssistantInitFields.length > 0) return false;
  return true;
}

export function buildScenarioRunStartInput(args: {
  workspaceId: string;
  selectedScenarioDeckId: string;
  scenarioJsonText: string;
  assistantInitJsonText: string;
}): ScenarioRunStartInput {
  return {
    workspaceId: args.workspaceId,
    scenarioDeckId: args.selectedScenarioDeckId,
    scenarioInput: toOptionalJsonText(args.scenarioJsonText),
    assistantInit: toOptionalJsonText(args.assistantInitJsonText),
  };
}

export function buildAssistantChatStartInput(args: {
  workspaceId: string;
  assistantInitJsonText: string;
}): AssistantChatStartInput {
  return {
    workspaceId: args.workspaceId,
    scenarioDeckId: null,
    scenarioInput: null,
    assistantInit: toOptionalJsonText(args.assistantInitJsonText),
  };
}
