import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { handleInitCommand } from "./init.ts";

const HELLO_EXAMPLE_FILES = [
  "hello.deck.md",
  "hello.grader.deck.md",
  "hello.test.deck.md",
];

function resolveExamplePath(filename: string): string {
  return path.fromFileUrl(
    new URL(import.meta.resolve(`../../examples/${filename}`)),
  );
}

Deno.test({
  name: "init copies hello example files",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.set("OPENROUTER_API_KEY", "test-key");

  try {
    Deno.chdir(tempDir);
    await handleInitCommand();

    for (const filename of HELLO_EXAMPLE_FILES) {
      const expected = await Deno.readTextFile(resolveExamplePath(filename));
      const actualPath = path.join(tempDir, "gambit", "examples", filename);
      const actual = await Deno.readTextFile(actualPath);
      assertEquals(actual, expected);
    }

    assert(
      !await exists(path.join(tempDir, "gambit", ".env")),
      "should not create .env when OPENROUTER_API_KEY is set",
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
