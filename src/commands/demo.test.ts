import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { handleDemoCommand } from "./demo.ts";
import { resolveScaffoldPath } from "./scaffold_utils.ts";

const HELLO_EXAMPLE_FILES = [
  "deno.json",
  "hello.deck.md",
  "hello.grader.deck.md",
  "hello.test.deck.md",
  "package.json",
  "schemas/grader_input_conversation.zod.ts",
  "schemas/grader_input_turns.zod.ts",
  "schemas/grader_output.zod.ts",
];

const EXAMPLE_DIRECTORIES = [
  "examples",
];

Deno.test({
  name: "demo copies hello example files",
  permissions: { read: true, write: true, env: true },
}, async () => {
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();
  const originalKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.set("OPENROUTER_API_KEY", "test-key");

  try {
    Deno.chdir(tempDir);
    await handleDemoCommand();

    for (const filename of HELLO_EXAMPLE_FILES) {
      const expected = await Deno.readTextFile(
        resolveScaffoldPath("demo", filename),
      );
      const actualPath = path.join(tempDir, "gambit", filename);
      const actual = await Deno.readTextFile(actualPath);
      assertEquals(actual, expected);
    }

    for (const directory of EXAMPLE_DIRECTORIES) {
      const expectedRoot = resolveScaffoldPath("demo", directory);
      const actualRoot = path.join(tempDir, "gambit", directory);
      const expectedFiles = await collectFiles(expectedRoot);
      const actualFiles = await collectFiles(actualRoot);
      assertEquals(actualFiles.sort(), expectedFiles.sort());
      for (const relativePath of expectedFiles) {
        const expected = await Deno.readTextFile(
          path.join(expectedRoot, relativePath),
        );
        const actual = await Deno.readTextFile(
          path.join(actualRoot, relativePath),
        );
        assertEquals(actual, expected);
      }
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

async function collectFiles(root: string): Promise<Array<string>> {
  const files: Array<string> = [];
  await visit(root, "", files);
  return files;
}

async function visit(dir: string, prefix: string, files: Array<string>) {
  for await (const entry of Deno.readDir(dir)) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory) {
      await visit(absolute, relative, files);
      continue;
    }
    if (entry.isFile) {
      files.push(relative);
      continue;
    }
    throw new Error(`Unsupported entry type for ${absolute}`);
  }
}
