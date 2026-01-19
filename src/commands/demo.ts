import * as path from "@std/path";
import {
  ensureDirectory,
  ensureOpenRouterEnv,
  ensureScaffoldDirectory,
  ensureScaffoldFile,
  resolveInvokePrefix,
} from "./scaffold_utils.ts";

const logger = console;

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

export async function handleDemoCommand() {
  const rootDir = path.resolve(Deno.cwd(), "gambit");
  await ensureDirectory(rootDir);

  const deckPath = path.join(rootDir, "hello.deck.md");
  let exampleCreated = false;
  for (const filename of HELLO_EXAMPLE_FILES) {
    const created = await ensureScaffoldFile(
      "demo",
      path.join(rootDir, filename),
      filename,
    );
    exampleCreated ||= created;
  }

  for (const directory of EXAMPLE_DIRECTORIES) {
    const created = await ensureScaffoldDirectory(
      "demo",
      path.join(rootDir, directory),
      directory,
    );
    exampleCreated ||= created;
  }

  const envPath = path.join(rootDir, ".env");
  const envUpdated = await ensureOpenRouterEnv(envPath);

  if (!exampleCreated && !envUpdated) {
    logger.log("gambit demo already initialized; nothing to do.");
  }
  logger.log("Try it:");
  logger.log(
    `  ${resolveInvokePrefix()} repl ${path.relative(Deno.cwd(), deckPath)}`,
  );
}
