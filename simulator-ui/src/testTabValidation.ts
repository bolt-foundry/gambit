export type TestTabBlockingMessageArgs = {
  hasScenarioSelection: boolean;
  scenarioJsonErrorCount: number;
  assistantInitJsonErrorCount: number;
  missingScenarioFields: Array<string>;
  missingAssistantInitFields: Array<string>;
};

function formatFieldList(fields: Array<string>): string {
  return `${fields.slice(0, 6).join(", ")}${fields.length > 6 ? "…" : ""}`;
}

export function buildTestTabBlockingMessage(
  args: TestTabBlockingMessageArgs,
): string {
  if (!args.hasScenarioSelection) {
    return "Select a scenario deck to run.";
  }
  if (
    args.scenarioJsonErrorCount > 0 || args.assistantInitJsonErrorCount > 0
  ) {
    return "Fix invalid JSON fields to run.";
  }
  if (args.missingScenarioFields.length > 0) {
    return `Missing required scenario fields: ${
      formatFieldList(args.missingScenarioFields)
    }`;
  }
  if (args.missingAssistantInitFields.length > 0) {
    return `Missing required assistant init fields: ${
      formatFieldList(args.missingAssistantInitFields)
    }`;
  }
  return "";
}

export function buildAssistantInitFillMessage(
  missingAssistantInitFields: Array<string>,
): string {
  return `Missing required assistant init fields will be requested from the assistant: ${
    formatFieldList(missingAssistantInitFields)
  }`;
}
