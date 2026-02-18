import { assertStringIncludes } from "@std/assert";
import * as path from "@std/path";
import { createWorkspaceScaffoldAtRoot } from "./workspace.ts";

Deno.test("workspace scaffold default scenario uses scenario participant snippet", async () => {
  const dir = await Deno.makeTempDir();
  const rootDir = path.join(dir, "workspace");
  await createWorkspaceScaffoldAtRoot(rootDir);

  const scenarioPromptPath = path.join(
    rootDir,
    "scenarios",
    "default",
    "PROMPT.md",
  );
  const prompt = await Deno.readTextFile(scenarioPromptPath);

  assertStringIncludes(
    prompt,
    "gambit://snippets/scenario-participant.md",
  );
  assertStringIncludes(
    prompt,
    "End the scenario by returning an empty response.",
  );
});
