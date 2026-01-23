import { assert } from "@std/assert";
import * as path from "@std/path";
import { handleInitCommand } from "./init.ts";

Deno.test({
  name: "init prepares the default gambit directory without running the chat",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.set("OPENROUTER_API_KEY", "test-key");

  try {
    Deno.chdir(tempDir);
    await handleInitCommand(undefined, { interactive: false });
    const projectRoot = path.join(tempDir, "gambit");
    assert(await exists(projectRoot), "project root should exist");
    assert(
      !await exists(path.join(projectRoot, ".env")),
      "should not create .env when OPENROUTER_API_KEY is set",
    );
    assert(
      !await exists(path.join(projectRoot, "root.deck.md")),
      "init should not write root.deck.md before the chat runs",
    );
    assert(
      !await exists(path.join(projectRoot, "tests", "first.test.deck.md")),
      "init should not write test deck before the chat runs",
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
  name: "init accepts a custom project path argument without running the chat",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.set("OPENROUTER_API_KEY", "test-key");

  try {
    Deno.chdir(tempDir);
    await handleInitCommand("custom/project", { interactive: false });
    const projectRoot = path.join(tempDir, "custom", "project");
    assert(await exists(projectRoot), "custom project root should exist");
  } finally {
    Deno.chdir(originalCwd);
    if (originalKey === undefined) {
      Deno.env.delete("OPENROUTER_API_KEY");
    } else {
      Deno.env.set("OPENROUTER_API_KEY", originalKey);
    }
  }
});

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
