import * as path from "@std/path";
import { existsSync } from "@std/fs";

export type WorkspaceScaffold = {
  id: string;
  rootDir: string;
  rootDeckPath: string;
  createdAt: string;
};

export type WorkspaceRootScaffold = {
  rootDir: string;
  rootDeckPath: string;
};

type WorkspaceScaffoldOptions = {
  baseDir: string;
  id?: string;
  now?: Date;
};

const ROOT_PROMPT = `+++
label = "Workspace Root"
description = "Starter root deck for this workspace."

[modelParams]
model = ["ollama/hf.co/LiquidAI/LFM2-1.2B-Tool-GGUF:latest", "openrouter/openai/gpt-5.1-chat"]

[modelParams.reasoning]
effort = "low"
summary = "detailed"

[[scenarios]]
path = "./scenarios/default/PROMPT.md"
label = "Default scenario"
description = "Quick sanity check scenario."

[[graders]]
path = "./graders/default/PROMPT.md"
label = "Default grader"
description = "Simple grader to start."
+++

You are the default deck for a new Gambit workspace.

## Assistant Persona

- You are a minimal placeholder deck used to bootstrap a blank workspace.
- You keep responses short and avoid introducing product narrative.

## User Persona

- The user is in the Build tab and expects guidance on what to do next.

## Behavior

- If asked what to do, reply exactly: "Use the Build tab to draft your deck."
- Keep all other responses brief, plain text, and focused on build guidance.
`;

const ROOT_INTENT = `# Workspace Intent

## Purpose

- Provide a starter workspace deck for the Build/Test/Grade loop.

## Constraints

- Keep the initial behavior simple and easy to replace.

## Tradeoffs

- Favor clarity over advanced functionality in the starter scaffold.
`;

const DEFAULT_SCENARIO_PROMPT = `+++
label = "Default scenario"
description = "Starter scenario for this workspace."
contextSchema = "gambit://schemas/scenarios/plain_chat_input_optional.zod.ts"
responseSchema = "gambit://schemas/scenarios/plain_chat_output.zod.ts"

[modelParams]
model = ["ollama/hf.co/LiquidAI/LFM2-1.2B-Tool-GGUF:latest", "openrouter/openai/gpt-5.1-chat"]
+++

![scenario-participant](gambit://snippets/scenario-participant.md)

You are a user testing the assistant.

Conversation plan:

1. Start by asking: "What can you help me with?"
2. If the assistant replies, answer once with: "Thanks!"
3. End the scenario by returning an empty response.

Rules:

- Keep replies short and plain text.
- Do not include markdown or lists.
- If the assistant says it is done, or ends the session, respond with an empty message.
`;

const DEFAULT_GRADER_PROMPT = `+++
label = "Default grader"
description = "Starter grader for this workspace."
contextSchema = "gambit://schemas/graders/contexts/conversation.zod.ts"
responseSchema = "gambit://schemas/graders/grader_output.zod.ts"

[modelParams]
model = ["ollama/hf.co/LiquidAI/LFM2-1.2B-Tool-GGUF:latest", "openrouter/openai/gpt-5.1-chat"]
+++

![respond](gambit://snippets/respond.md)

You are grading the assistant's response for clarity and helpfulness.

Score 1 if the assistant is clear and directly answers the user.
Score 0 if the response is vague or unhelpful.

Provide a short reason.
`;

const toStamp = (date: Date): string =>
  date.toISOString().replace(/[:.]/g, "-");

const generateWorkspaceId = (date: Date): string =>
  `workspace-${toStamp(date)}-${crypto.randomUUID().slice(0, 8)}`;

async function ensureDir(dir: string) {
  await Deno.mkdir(dir, { recursive: true });
}

async function writeFile(pathValue: string, contents: string) {
  await Deno.writeTextFile(pathValue, contents);
}

function ensureEmptyPath(pathValue: string) {
  if (existsSync(pathValue)) {
    throw new Error(`Init target already exists: ${pathValue}`);
  }
}

export async function createWorkspaceScaffoldAtRoot(
  rootDir: string,
): Promise<WorkspaceRootScaffold> {
  const resolvedRoot = path.resolve(rootDir);
  await ensureDir(resolvedRoot);

  const rootDeckPath = path.join(resolvedRoot, "PROMPT.md");
  const intentPath = path.join(resolvedRoot, "INTENT.md");
  const scenariosDir = path.join(resolvedRoot, "scenarios", "default");
  const gradersDir = path.join(resolvedRoot, "graders", "default");
  const scenarioPromptPath = path.join(scenariosDir, "PROMPT.md");
  const graderPromptPath = path.join(gradersDir, "PROMPT.md");

  await ensureEmptyPath(rootDeckPath);
  await ensureEmptyPath(intentPath);
  await ensureEmptyPath(scenarioPromptPath);
  await ensureEmptyPath(graderPromptPath);

  await ensureDir(scenariosDir);
  await ensureDir(gradersDir);

  await writeFile(rootDeckPath, ROOT_PROMPT);
  await writeFile(intentPath, ROOT_INTENT);
  await writeFile(scenarioPromptPath, DEFAULT_SCENARIO_PROMPT);
  await writeFile(graderPromptPath, DEFAULT_GRADER_PROMPT);

  return {
    rootDir: resolvedRoot,
    rootDeckPath,
  };
}

export async function createWorkspaceScaffold(
  opts: WorkspaceScaffoldOptions,
): Promise<WorkspaceScaffold> {
  const baseDir = path.resolve(opts.baseDir);
  await ensureDir(baseDir);
  const now = opts.now ?? new Date();

  let workspaceId = opts.id ?? generateWorkspaceId(now);
  let rootDir = path.join(baseDir, workspaceId);
  if (existsSync(rootDir)) {
    workspaceId = generateWorkspaceId(new Date(now.getTime() + 1));
    rootDir = path.join(baseDir, workspaceId);
  }

  const rootDeckPath = path.join(rootDir, "PROMPT.md");
  const intentPath = path.join(rootDir, "INTENT.md");
  const scenariosDir = path.join(rootDir, "scenarios", "default");
  const gradersDir = path.join(rootDir, "graders", "default");

  await ensureDir(scenariosDir);
  await ensureDir(gradersDir);

  await writeFile(rootDeckPath, ROOT_PROMPT);
  await writeFile(intentPath, ROOT_INTENT);
  await writeFile(
    path.join(scenariosDir, "PROMPT.md"),
    DEFAULT_SCENARIO_PROMPT,
  );
  await writeFile(path.join(gradersDir, "PROMPT.md"), DEFAULT_GRADER_PROMPT);

  return {
    id: workspaceId,
    rootDir,
    rootDeckPath,
    createdAt: now.toISOString(),
  };
}
