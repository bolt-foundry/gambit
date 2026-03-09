import { ensureDir } from "@std/fs";
import * as path from "@std/path";

export type TestTabOpenResponsesDemoFixture = {
  rootDeckPath: string;
  scenarioLabel: string;
};

const ROOT_PROMPT = `+++
label = "Test Tab OpenResponses Demo Root"
description = "Deterministic root deck for the test-tab OpenResponses demo."

[modelParams]
model = ["dummy-model"]

[[scenarios]]
path = "./scenarios/assistant-first/PROMPT.md"
label = "Assistant first"
description = "Deterministic assistant-first scenario."
+++

You are a deterministic root deck for the test-tab OpenResponses demo.
`;

const SCENARIO_PROMPT = `+++
label = "Assistant first"
description = "Deterministic assistant-first scenario."
startMode = "assistant"
contextSchema = "gambit://schemas/scenarios/plain_chat_input_optional.zod.ts"
responseSchema = "gambit://schemas/scenarios/plain_chat_output.zod.ts"

[modelParams]
model = ["dummy-model"]
+++

Reply with a short assistant message.
`;

export async function createTestTabOpenResponsesDemoFixture(
  serveRoot: string,
): Promise<TestTabOpenResponsesDemoFixture> {
  const rootDeckPath = path.join(serveRoot, "PROMPT.md");
  const scenarioPath = path.join(
    serveRoot,
    "scenarios",
    "assistant-first",
    "PROMPT.md",
  );

  await ensureDir(path.dirname(scenarioPath));
  await Deno.writeTextFile(rootDeckPath, ROOT_PROMPT);
  await Deno.writeTextFile(scenarioPath, SCENARIO_PROMPT);

  return {
    rootDeckPath,
    scenarioLabel: "Assistant first",
  };
}
