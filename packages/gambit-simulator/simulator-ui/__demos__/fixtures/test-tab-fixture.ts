import { ensureDir } from "@std/fs";
import * as path from "@std/path";

export type TestTabDemoFixture = {
  rootDeckPath: string;
  scenarioLabels: Array<string>;
  brokenScenarioLabel: string;
};

type TestTabDemoFixtureOptions = {
  includeBrokenScenario?: boolean;
  useDistinctInputSchemas?: boolean;
};

const ROOT_PROMPT_HEADER = `+++
label = "Test Tab Demo Root"
description = "Fixture root deck for test-tab demo."

[modelParams]
model = ["openrouter/openai/gpt-5.1-chat"]
`;

const ROOT_PROMPT_HEADER_WITH_ASSISTANT_SCHEMA = `+++
label = "Test Tab Demo Root"
description = "Fixture root deck for test-tab demo."
startMode = "assistant"
contextSchema = "./schemas/assistant_init.zod.ts"
responseSchema = "gambit://schemas/scenarios/plain_chat_output.zod.ts"

[modelParams]
model = ["openrouter/openai/gpt-5.1-chat"]
`;

const ROOT_SCENARIO_ALPHA_BLOCK = `[[scenarios]]
path = "./scenarios/alpha/PROMPT.md"
label = "Alpha scenario"
description = "Fixture scenario alpha."
`;

const ROOT_SCENARIO_BETA_BLOCK = `[[scenarios]]
path = "./scenarios/beta/PROMPT.md"
label = "Beta scenario"
description = "Fixture scenario beta."
`;

const ROOT_SCENARIO_BROKEN_BLOCK = `[[scenarios]]
path = "./scenarios/broken/PROMPT.md"
label = "Broken scenario"
description = "Fixture scenario intentionally fails."
`;

const ROOT_GRADER_BLOCK = `[[graders]]
path = "./graders/default/PROMPT.md"
label = "Default grader"
description = "Fixture grader for grade-tab demo."
+++

You are a fixture root deck for the test-tab demo.
`;

function buildRootPrompt(includeBrokenScenario: boolean): string {
  return [
    ROOT_PROMPT_HEADER.trimEnd(),
    "",
    ROOT_SCENARIO_ALPHA_BLOCK.trimEnd(),
    "",
    ROOT_SCENARIO_BETA_BLOCK.trimEnd(),
    ...(includeBrokenScenario
      ? ["", ROOT_SCENARIO_BROKEN_BLOCK.trimEnd()]
      : []),
    "",
    ROOT_GRADER_BLOCK.trimEnd(),
  ].join("\n");
}

const SCENARIO_ALPHA_PROMPT = `+++
label = "Alpha scenario"
description = "Fixture scenario alpha."
contextSchema = "gambit://schemas/scenarios/plain_chat_input_optional.zod.ts"
responseSchema = "gambit://schemas/scenarios/plain_chat_output.zod.ts"

[modelParams]
model = ["openrouter/openai/gpt-5.1-chat"]
+++

![scenario-participant](gambit://snippets/scenario-participant.md)

Ask for a quick project status update.
`;

const SCENARIO_ALPHA_PROMPT_WITH_DISTINCT_SCHEMA = `+++
label = "Alpha scenario"
description = "Fixture scenario alpha."
contextSchema = "../../schemas/scenario_input.zod.ts"
responseSchema = "gambit://schemas/scenarios/plain_chat_output.zod.ts"

[modelParams]
model = ["openrouter/openai/gpt-5.1-chat"]
+++

![scenario-participant](gambit://snippets/scenario-participant.md)

Use the scenarioToken field to ask for a project status update.
`;

const SCENARIO_BETA_PROMPT = `+++
label = "Beta scenario"
description = "Fixture scenario beta."
contextSchema = "gambit://schemas/scenarios/plain_chat_input_optional.zod.ts"
responseSchema = "gambit://schemas/scenarios/plain_chat_output.zod.ts"

[modelParams]
model = ["openrouter/openai/gpt-5.1-chat"]
+++

![scenario-participant](gambit://snippets/scenario-participant.md)

Ask for a short summary of completed tasks.
`;

const SCENARIO_BETA_PROMPT_WITH_DISTINCT_SCHEMA = `+++
label = "Beta scenario"
description = "Fixture scenario beta."
contextSchema = "../../schemas/scenario_input.zod.ts"
responseSchema = "gambit://schemas/scenarios/plain_chat_output.zod.ts"

[modelParams]
model = ["openrouter/openai/gpt-5.1-chat"]
+++

![scenario-participant](gambit://snippets/scenario-participant.md)

Use the scenarioToken field to ask for a short summary of completed tasks.
`;

const SCENARIO_BROKEN_PROMPT = `+++
label = "Broken scenario"
description = "Fixture scenario intentionally fails."
contextSchema = "gambit://schemas/scenarios/plain_chat_input_optional.zod.ts"
responseSchema = "gambit://schemas/scenarios/does_not_exist.zod.ts"

[modelParams]
model = ["openrouter/openai/gpt-5.1-chat"]
+++

This scenario intentionally points at an invalid response schema.
`;

const DEFAULT_GRADER_PROMPT = `+++
label = "Default grader"
description = "Fixture grader for grade-tab demo."
contextSchema = "gambit://schemas/graders/contexts/conversation.zod.ts"
responseSchema = "gambit://schemas/graders/grader_output.zod.ts"

[modelParams]
model = ["openrouter/openai/gpt-5.1-chat"]
+++

You are grading the assistant's response for clarity and helpfulness.

Score 1 if the assistant is clear and directly answers the user.
Score 0 if the response is vague or unhelpful.

Provide a short reason.
`;

export async function createTestTabDemoFixture(
  serveRoot: string,
  options: TestTabDemoFixtureOptions = {},
): Promise<TestTabDemoFixture> {
  const includeBrokenScenario = options.includeBrokenScenario ?? true;
  const useDistinctInputSchemas = options.useDistinctInputSchemas ?? false;
  const rootDeckPath = path.join(serveRoot, "PROMPT.md");
  const alphaPath = path.join(serveRoot, "scenarios", "alpha", "PROMPT.md");
  const betaPath = path.join(serveRoot, "scenarios", "beta", "PROMPT.md");
  const brokenPath = path.join(serveRoot, "scenarios", "broken", "PROMPT.md");
  const graderPath = path.join(serveRoot, "graders", "default", "PROMPT.md");
  const schemaDir = path.join(serveRoot, "schemas");
  const assistantSchemaPath = path.join(schemaDir, "assistant_init.zod.ts");
  const scenarioSchemaPath = path.join(schemaDir, "scenario_input.zod.ts");

  await ensureDir(path.dirname(alphaPath));
  await ensureDir(path.dirname(betaPath));
  if (includeBrokenScenario) {
    await ensureDir(path.dirname(brokenPath));
  }
  await ensureDir(path.dirname(graderPath));
  if (useDistinctInputSchemas) {
    await ensureDir(schemaDir);
  }
  await Deno.writeTextFile(
    rootDeckPath,
    useDistinctInputSchemas
      ? buildRootPrompt(includeBrokenScenario).replace(
        ROOT_PROMPT_HEADER.trimEnd(),
        ROOT_PROMPT_HEADER_WITH_ASSISTANT_SCHEMA.trimEnd(),
      )
      : buildRootPrompt(includeBrokenScenario),
  );
  await Deno.writeTextFile(
    alphaPath,
    useDistinctInputSchemas
      ? SCENARIO_ALPHA_PROMPT_WITH_DISTINCT_SCHEMA
      : SCENARIO_ALPHA_PROMPT,
  );
  await Deno.writeTextFile(
    betaPath,
    useDistinctInputSchemas
      ? SCENARIO_BETA_PROMPT_WITH_DISTINCT_SCHEMA
      : SCENARIO_BETA_PROMPT,
  );
  if (includeBrokenScenario) {
    await Deno.writeTextFile(brokenPath, SCENARIO_BROKEN_PROMPT);
  }
  await Deno.writeTextFile(graderPath, DEFAULT_GRADER_PROMPT);
  if (useDistinctInputSchemas) {
    await Deno.writeTextFile(
      assistantSchemaPath,
      `import { z } from "zod";

export default z.object({
  assistantToken: z.string().trim().min(1),
}).strict();
`,
    );
    await Deno.writeTextFile(
      scenarioSchemaPath,
      `import { z } from "zod";

export default z.object({
  scenarioToken: z.string().trim().min(1),
}).strict();
`,
    );
  }

  return {
    rootDeckPath,
    scenarioLabels: includeBrokenScenario
      ? ["Alpha scenario", "Beta scenario", "Broken scenario"]
      : ["Alpha scenario", "Beta scenario"],
    brokenScenarioLabel: "Broken scenario",
  };
}
