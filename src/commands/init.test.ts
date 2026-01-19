import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { handleInitCommand } from "./init.ts";
import { resolveScaffoldPath } from "./scaffold_utils.ts";

const STARTER_FILES = [
  "deno.json",
  "package.json",
  "README.md",
  "gambit.toml",
  "decks/README.md",
  "graders/README.md",
  "tests/README.md",
  "schemas/README.md",
  "actions/README.md",
  ".gambit/.gitkeep",
];

Deno.test({
  name: "init scaffolds starter files into default gambit directory",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.set("OPENROUTER_API_KEY", "test-key");

  try {
    Deno.chdir(tempDir);
    await handleInitCommand();
    const projectRoot = path.join(tempDir, "gambit");
    await assertStarterFiles(projectRoot);
    assert(
      !await exists(path.join(projectRoot, ".env")),
      "should not create .env when OPENROUTER_API_KEY is set",
    );
    assert(
      !await exists(path.join(projectRoot, "examples")),
      "starter project should not include the demo gallery",
    );
    assert(
      await exists(path.join(projectRoot, ".gambit", ".gitkeep")),
      ".gambit workspace should be initialized",
    );
  } finally {
    Deno.chdir(originalCwd);
    if (originalKey === undefined) {
      Deno.env.delete("OPENROUTER_API_KEY");
    } else {
      Deno.env.set("OPENROUTER_API_KEY", originalKey);
    }
  }
});

Deno.test({
  name: "init accepts a custom project path argument",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.set("OPENROUTER_API_KEY", "test-key");

  try {
    Deno.chdir(tempDir);
    await handleInitCommand("custom/project");
    const projectRoot = path.join(tempDir, "custom", "project");
    await assertStarterFiles(projectRoot);
  } finally {
    Deno.chdir(originalCwd);
    if (originalKey === undefined) {
      Deno.env.delete("OPENROUTER_API_KEY");
    } else {
      Deno.env.set("OPENROUTER_API_KEY", originalKey);
    }
  }
});

async function assertStarterFiles(projectRoot: string) {
  for (const filename of STARTER_FILES) {
    const expected = await Deno.readTextFile(
      resolveScaffoldPath("init", filename),
    );
    const actualPath = path.join(projectRoot, filename);
    const actual = await Deno.readTextFile(actualPath);
    assertEquals(actual, expected);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await Deno.stat(filePath);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}
