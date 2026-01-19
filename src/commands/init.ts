import * as path from "@std/path";
import {
  ensureDirectory,
  ensureOpenRouterEnv,
  ensureScaffoldDirectory,
  ensureScaffoldFile,
  resolveInvokePrefix,
} from "./scaffold_utils.ts";

const logger = console;

const ROOT_FILES = [
  "deno.json",
  "package.json",
  "README.md",
  "gambit.toml",
];

const SCAFFOLD_DIRECTORIES = [
  "decks",
  "graders",
  "tests",
  "schemas",
  "actions",
  ".gambit",
];

export async function handleInitCommand(targetPath?: string) {
  const normalizedTarget = targetPath?.trim();
  const projectPath = normalizedTarget && normalizedTarget.length > 0
    ? normalizedTarget
    : "gambit";
  const rootDir = path.resolve(Deno.cwd(), projectPath);
  await ensureDirectory(rootDir);

  let createdAny = false;
  for (const filename of ROOT_FILES) {
    const created = await ensureScaffoldFile(
      "init",
      path.join(rootDir, filename),
      filename,
    );
    createdAny ||= created;
  }

  for (const directory of SCAFFOLD_DIRECTORIES) {
    const created = await ensureScaffoldDirectory(
      "init",
      path.join(rootDir, directory),
      directory,
    );
    createdAny ||= created;
  }

  const envPath = path.join(rootDir, ".env");
  const envUpdated = await ensureOpenRouterEnv(envPath);

  if (!createdAny && !envUpdated) {
    logger.log("gambit project already initialized; nothing to do.");
    return;
  }

  const projectRel = path.relative(Deno.cwd(), rootDir) || ".";
  logger.log("Starter project ready. Next steps:");
  logger.log(`  cd ${projectRel}`);
  logger.log("  # add decks under ./decks/");
  logger.log(`  ${resolveInvokePrefix()} repl decks/<deck>.deck.md`);
}
